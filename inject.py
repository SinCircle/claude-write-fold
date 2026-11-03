"""Build and launch an independent, structurally matched Windows Claude Code copy."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent
MAGIC = b'\n---- Bun! ----\n'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def atomic_json(path, obj):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding='utf8')
    temporary.replace(path)


def source_path(explicit=None):
    if explicit:
        source = Path(explicit).expanduser().resolve()
        require(source.is_file(), f'Source executable not found: {source}')
        return source
    candidates = [Path.home()/'.local/bin/claude.exe']
    found = shutil.which('claude.exe')
    if found:
        candidates.append(Path(found))
    for path in candidates:
        if path.is_file() and not path.resolve().is_relative_to(ROOT):
            return path.resolve()
    raise RuntimeError('Cannot find the installed native claude.exe. Use --source "full path to claude.exe".')


def graph_info(raw):
    require(len(raw) > 128 and raw[:2] == b'MZ', 'A Windows native executable is required.')
    pe = struct.unpack_from('<I', raw, 0x3c)[0]
    require(pe+24 <= len(raw) and raw[pe:pe+4] == b'PE\0\0', 'Unsupported PE header.')
    machine, count = struct.unpack_from('<HH', raw, pe+4)
    optional_size = struct.unpack_from('<H', raw, pe+20)[0]
    optional = pe+24
    require(machine == 0x8664 and optional_size >= 152, 'Only Windows x64 PE32+ is supported.')
    require(struct.unpack_from('<H', raw, optional)[0] == 0x20b, 'Unsupported PE format.')
    require(0 < count <= 64 and optional+optional_size+count*40 <= len(raw), 'Invalid section table.')
    sections = []
    for i in range(count):
        at = optional+optional_size+i*40
        vsize, va, size, off = struct.unpack_from('<IIII', raw, at+8)
        require(off+size <= len(raw), 'Section extends past the source file.')
        sections.append((raw[at:at+8].rstrip(b'\0'), at, vsize, va, size, off))
    name, header, vsize, va, size, off = sections[-1]
    require(name == b'.bun' and size >= 56, 'Unsupported Bun container: .bun must be the final section.')
    require(all(s[5]+s[4] <= off for s in sections[:-1]), 'Overlapping sections are unsupported.')
    length = struct.unpack_from('<Q', raw, off)[0]
    require(vsize == length+8 and length+8 <= size, 'Bun section layout changed.')
    graph = raw[off+8:off+8+length]
    require(graph.endswith(MAGIC), 'Bun trailer changed.')
    trailer = len(graph)-48
    byte_count, table, table_length, entry, argv, argv_length, flags = struct.unpack_from('<QIIIIII', graph, trailer)
    require(byte_count == trailer and table_length > 0 and table_length % 52 == 0, 'Bun module record layout changed.')
    require(table+table_length <= trailer and entry < table_length//52, 'Invalid Bun module table.')
    if flags & 32:
        require(table+table_length+table_length//52*4 <= trailer, 'Bun checksum table layout changed.')
    modules = []
    for index in range(table_length//52):
        record = table+index*52
        fields = struct.unpack_from('<12I4B', graph, record)
        for position in (0, 2):
            require(fields[position]+fields[position+1] <= trailer, 'Invalid module source pointer.')
        module_name = graph[fields[0]:fields[0]+fields[1]].decode('utf8')
        modules.append({'index': index, 'record': record, 'fields': fields, 'name': module_name})
    return dict(graph=graph, trailer=trailer, table=table, table_length=table_length,
                flags=flags, modules=modules, sections=sections, optional=optional)


def select_modules(info):
    candidates = {'grouping': [], 'renderer': [], 'focus': [], 'clock': []}
    for module in info['modules']:
        f = module['fields']
        source = info['graph'][f[2]:f[2]+f[3]]
        if b'write-fold:' in source or b'function writeFoldLivePreview(' in source:
            raise RuntimeError('The selected source already contains Write Fold. Select the original installation.')
        if all(word in source for word in (b'latestDisplayHint', b'isSearchOrReadCommand', b'scratchpadWriteCount', b'accountMemorySearchCount')):
            candidates['grouping'].append(module)
        if all(word in source for word in (b'latestDisplayHint', b'isActiveGroup', b'ToolGroup', b'progressMessagesByToolUseID', b'editFileCount')):
            candidates['renderer'].append(module)
        if all(word in source for word in (b'isActiveCollapsedGroup', b'isFocusedTurnLoading', b'hasDisplayedStreamingText', b'focused.inProgressToolUseIDs')):
            candidates['focus'].append(module)
        if all(word in source for word in (b'subscribeKeepAlive', b'isVisible:', b'subscribeLayout', b'getComputedHeight', b'Math.ceil(')):
            candidates['clock'].append(module)
    for kind, hits in candidates.items():
        require(len(hits) == 1, f'Cannot uniquely identify the {kind} module ({len(hits)} matches). Upstream structure needs adaptation.')
        require(hits[0]['fields'][-3] == 1, f'{kind} is no longer a supported JavaScript module.')
    selected = {kind: hits[0] for kind, hits in candidates.items()}
    require(len({m['index'] for m in selected.values()}) == len(selected), 'Module structure changed: expected separate grouping, renderer, focus and clock modules.')
    return selected


def rebuild(raw, info, patches):
    graph, trailer = info['graph'], info['trailer']
    payload = bytearray(graph[:trailer])
    expected_original = bytearray(payload)
    for module, code in sorted(patches, key=lambda pair: pair[0]['index']):
        record, index = module['record'], module['index']
        start = len(payload)
        payload.extend(code+b'\0')
        struct.pack_into('<II', payload, record+8, start, len(code))
        payload[record+16:record+48] = bytes(32)
        payload[record+48] = 0
        expected_original[record:record+52] = payload[record:record+52]
        if info['flags'] & 32:
            slot = info['table']+info['table_length']+index*4
            struct.pack_into('<I', payload, slot, 0)
            expected_original[slot:slot+4] = bytes(4)
    require(payload[:trailer] == expected_original, 'Unexpected changes outside selected module metadata.')
    end = len(payload)
    payload.extend(graph[trailer:])
    struct.pack_into('<Q', payload, end, end)
    struct.pack_into('<I', payload, end+28, info['flags'] & ~16)
    section = struct.pack('<Q', len(payload))+payload
    name, header, vsize, va, size, off = info['sections'][-1]
    optional = info['optional']
    fa, sa = struct.unpack_from('<I', raw, optional+36)[0], struct.unpack_from('<I', raw, optional+32)[0]
    require(fa > 0 and sa > 0 and fa & (fa-1) == 0 and sa & (sa-1) == 0, 'Invalid PE alignment.')
    align = lambda n, a: (n+a-1)//a*a
    raw_size = align(len(section), fa)
    result = bytearray(raw[:off])+section+bytes(raw_size-len(section))
    struct.pack_into('<I', result, header+8, len(section))
    struct.pack_into('<I', result, header+16, raw_size)
    struct.pack_into('<I', result, optional+56, align(va+len(section), sa))
    struct.pack_into('<I', result, optional+64, 0)
    result[optional+112+4*8:optional+112+5*8] = bytes(8)
    for s in info['sections'][:-1]:
        require(result[s[5]:s[5]+s[4]] == raw[s[5]:s[5]+s[4]], 'Native section changed unexpectedly.')
    # Parse the completed candidate independently before attempting to run it.
    completed = graph_info(result)
    changed = [a['name'] for a,b in zip(info['modules'], completed['modules']) if a['fields'] != b['fields']]
    require(set(changed) == {m['name'] for m,_ in patches}, 'Unexpected module metadata changes.')
    return bytes(result)


def checked_process(args, timeout=30):
    env = dict(os.environ, DISABLE_AUTOUPDATER='1', DISABLE_UPDATES='1', DISABLE_TELEMETRY='1')
    done = subprocess.run(args, capture_output=True, timeout=timeout, env=env,
                          creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    require(done.returncode == 0, f'Check failed: {Path(args[0]).name}\n'+done.stderr.decode('utf8', 'replace')[-1800:])
    return done


def original_for(installed):
    """Recover the matching original only when this exact installed patch is known."""
    state_file = ROOT/'install.json'
    if state_file.exists():
        state = json.loads(state_file.read_text(encoding='utf8'))
        if str(installed) == state.get('installedPath') and digest(installed.read_bytes()) == state.get('patchedSha256'):
            original = (ROOT/state['originalBackup']).resolve()
            require(original.is_relative_to(ROOT/'backup_org') and original.is_file(), 'The matching original backup is missing.')
            require(digest(original.read_bytes()) == state['originalSha256'], 'Original backup checksum failed.')
            return original
    return installed


def backup_original(source, installed):
    raw = source.read_bytes()
    # Reject a patched source before labelling any file as an original backup.
    select_modules(graph_info(raw))
    version_text = checked_process([str(source), '--version']).stdout.decode('utf8', 'replace')
    match = re.search(r'\b\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?', version_text)
    require(match, 'Cannot identify original version for backup.')
    sha = digest(raw)
    directory = ROOT/'backup_org'
    directory.mkdir(exist_ok=True)
    target = directory/f'claude-{match.group()}-{sha[:12]}.exe'
    if not target.exists():
        temporary = target.with_suffix('.exe.tmp')
        temporary.write_bytes(raw)
        temporary.replace(target)
    require(digest(target.read_bytes()) == sha, 'Original backup verification failed.')
    atomic_json(directory/'latest-original.json', {'version': match.group(), 'source': str(installed), 'backup': str(target), 'sha256': sha})
    return target


def replace_main(installed, candidate):
    """Publish a verified file from the same directory, with an in-use rename fallback."""
    fd, name = tempfile.mkstemp(prefix='.write-fold-', suffix='.exe', dir=installed.parent)
    os.close(fd)
    temporary = Path(name).resolve()
    require(temporary.parent == installed.parent, 'Invalid publication path.')
    displaced = None
    try:
        shutil.copy2(candidate, temporary)
        try:
            temporary.replace(installed)
        except PermissionError:
            # Windows may permit renaming an executable still held by an older
            # process even though replacing that pathname directly is denied.
            displaced = installed.with_name(installed.name+f'.write-fold-old-{time.time_ns()}')
            require(displaced.parent == installed.parent, 'Invalid preservation path.')
            installed.rename(displaced)
            try:
                temporary.rename(installed)
            except Exception:
                displaced.rename(installed)
                raise
        if displaced is not None:
            try:
                displaced.unlink()
            except PermissionError:
                print(f'An existing process still holds its old executable: {displaced}')
    finally:
        temporary.unlink(missing_ok=True)


def install_main(installed, candidate, original):
    candidate_hash, original_hash = digest(candidate.read_bytes()), digest(original.read_bytes())
    before_hash = digest(installed.read_bytes())
    allowed_hashes = {candidate_hash, original_hash}
    previous_install = ROOT/'install.json'
    if previous_install.exists():
        previous = json.loads(previous_install.read_text(encoding='utf8'))
        if previous.get('installedPath') == str(installed) and previous.get('originalSha256') == original_hash:
            allowed_hashes.add(previous.get('patchedSha256'))
    require(before_hash in allowed_hashes, 'The installed program changed since validation; rerun after the update finishes.')
    if before_hash != candidate_hash:
        replace_main(installed, candidate)
    try:
        require(digest(installed.read_bytes()) == candidate_hash, 'Installed executable hash differs from the verified candidate.')
        checked_process([str(installed), '--version'])
    except Exception:
        replace_main(installed, original)
        raise
    state = json.loads((ROOT/'current.json').read_text(encoding='utf8'))
    atomic_json(ROOT/'install.json', {'installedPath': str(installed), 'version': state['version'],
                'patchedSha256': candidate_hash, 'originalSha256': original_hash,
                'originalBackup': str(original.relative_to(ROOT)), 'candidate': str(candidate.relative_to(ROOT)),
                'installedAt': time.strftime('%Y-%m-%d %H:%M:%S')})
    print(f'Installed {state["version"]} with Write Fold: {installed}\nOriginal: {original}', flush=True)


def restore_main(installed):
    state = json.loads((ROOT/'install.json').read_text(encoding='utf8'))
    require(str(installed) == state['installedPath'], 'This path is not the recorded patched installation.')
    original = original_for(installed)
    require(original != installed, 'Installed file has changed; refusing to overwrite a newer or unknown version.')
    replace_main(installed, original)
    require(digest(installed.read_bytes()) == state['originalSha256'], 'Restore checksum failed.')
    print(f'Restored the unmodified original: {installed}')


def build(source, check_only=False, quiet=False):
    raw = source.read_bytes()
    source_hash = digest(raw)
    patch_hash = digest(Path(__file__).read_bytes()+(ROOT/'adapter.mjs').read_bytes()+(ROOT/'vendor/acorn.mjs').read_bytes())
    state_path = ROOT/'current.json'
    if not check_only and state_path.exists():
        old = json.loads(state_path.read_text(encoding='utf8'))
        relative = Path(old.get('target', ''))
        target = (ROOT/relative).resolve()
        if target.is_relative_to(ROOT/'versions') and old.get('sourceSha256') == source_hash and old.get('patchSha256') == patch_hash and target.is_file() and digest(target.read_bytes()) == old.get('patchedSha256'):
            if not quiet:
                print(f'Already current: {old["version"]}\n{target}')
            return target
    node = shutil.which('node.exe') or shutil.which('node')
    require(node, 'Node.js is required for structural compatibility checks.')
    info = graph_info(raw)
    selected = select_modules(info)
    original_version = checked_process([str(source), '--version'])
    version_text = original_version.stdout.decode('utf8', 'replace').strip()
    version_match = re.search(r'\b\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?', version_text)
    require(version_match, 'Cannot identify the installed Claude Code version.')
    version = version_match.group()
    print(f'Checking Claude Code {version} ...', flush=True)
    with tempfile.TemporaryDirectory(prefix='.build-', dir=ROOT) as task_dir:
        temporary = Path(task_dir).resolve()
        require(temporary.is_relative_to(ROOT) and temporary.name.startswith('.build-'), 'Invalid temporary directory.')
        manifest = {'modules': [], 'report': str(temporary/'adapter-report.json')}
        for kind, module in selected.items():
            f = module['fields']
            src, out = temporary/(kind+'.mjs'), temporary/(kind+'-patched.mjs')
            src.write_bytes(info['graph'][f[2]:f[2]+f[3]])
            manifest['modules'].append({'kind': kind, 'input': str(src), 'output': str(out)})
        manifest_path = temporary/'manifest.json'
        manifest_path.write_text(json.dumps(manifest), encoding='utf8')
        checked_process([node, str(ROOT/'adapter.mjs'), str(manifest_path)], timeout=120)
        adapter_report = json.loads((temporary/'adapter-report.json').read_text(encoding='utf8'))
        patches = [(selected[entry['kind']], Path(entry['output']).read_bytes()) for entry in manifest['modules']]
        candidate = rebuild(raw, info, patches)
        executable = temporary/'claude.exe'
        executable.write_bytes(candidate)
        for option in ('--version', '--help'):
            before = original_version if option == '--version' else checked_process([str(source), option])
            after = checked_process([str(executable), option])
            require((before.stdout, before.stderr) == (after.stdout, after.stderr), option+' output differs from the original.')
        require(digest(source.read_bytes()) == source_hash, 'Installed source changed during the build; rerun after its update completes.')
        report = dict(version=version, source=str(source), sourceSha256=source_hash, patchSha256=patch_hash,
                      patchedSha256=digest(candidate), createdAt=time.strftime('%Y-%m-%d %H:%M:%S'),
                      changedModules=[m['name'] for m,_ in patches], moduleCount=len(info['modules']),
                      validation={'structuralMatching': True, 'javascriptParsed': True, 'nativeSectionsUnchanged': True,
                                  'otherModulePayloadUnchanged': True, 'versionAndHelpMatch': True,
                                  'nativeTitlesUnchanged': True, 'futureVersionUiNotAutomaticallyVerified': True},
                      adapter=adapter_report)
        if check_only:
            print('PASS: structure, native payload preservation, version/help. No installed files or active copy changed.')
            return None
        directory = ROOT/'versions'/f'{version}-{source_hash[:12]}-{patch_hash[:10]}'
        directory.mkdir(parents=True, exist_ok=True)
        target = directory/'claude.exe'
        if target.exists():
            require(digest(target.read_bytes()) == report['patchedSha256'], 'An existing version directory has different contents; it was not overwritten.')
        else:
            executable.replace(target)
        report['target'] = str(target.relative_to(ROOT))
        atomic_json(directory/'report.json', report)
        atomic_json(state_path, {key:value for key,value in report.items() if key != 'adapter'})
        print(f'PASS: Write Fold patch built; native title and indicator components preserved.\n{target}', flush=True)
        return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', help='Original native claude.exe; auto-detected by default')
    parser.add_argument('--check', action='store_true', help='Check compatibility without activating a copy')
    parser.add_argument('--launch', action='store_true', help='Update if needed, then launch in the current directory')
    parser.add_argument('--update', action='store_true', help='Run the official latest-channel updater first')
    parser.add_argument('--install', action='store_true', help='Back up the original and replace the main installed executable')
    parser.add_argument('--restore', action='store_true', help='Restore the original matching the recorded installed patch')
    parser.add_argument('claude_args', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    require(not (args.check and (args.launch or args.install or args.update)), '--check cannot launch, install, or update.')
    installed = source_path(args.source)
    if args.install or args.update:
        require(not installed.is_relative_to(ROOT), 'The install/update destination must be the real main installation, outside this portable package.')
    if args.restore:
        require(not (args.check or args.launch or args.install or args.update), '--restore cannot be combined with other actions.')
        restore_main(installed)
        return 0
    original = original_for(installed)
    if args.update or args.install:
        original = backup_original(original, installed)
    if args.update:
        env = dict(os.environ)
        env.pop('DISABLE_AUTOUPDATER', None)
        env.pop('DISABLE_UPDATES', None)
        update = subprocess.run([str(installed), '--settings', '{"autoUpdatesChannel":"latest"}', 'update'], env=env, timeout=300)
        require(update.returncode == 0, 'Official update command failed; no patch was installed.')
        original = backup_original(original_for(installed), installed)
    target = build(original, args.check, args.launch)
    if args.install:
        install_main(installed, target, original)
    (ROOT/'last-error.txt').unlink(missing_ok=True)
    if args.launch:
        forwarded = args.claude_args[1:] if args.claude_args[:1] == ['--'] else args.claude_args
        env = dict(os.environ, DISABLE_AUTOUPDATER='1', DISABLE_UPDATES='1')
        return subprocess.call([str(target), *forwarded], env=env)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as exc:
        message = f'Write Fold stopped: {exc}\nNo unverified patch was installed. Original backups and previous working copies are preserved.'
        print(message, file=sys.stderr)
        (ROOT/'last-error.txt').write_text(message, encoding='utf8')
        sys.exit(1)
