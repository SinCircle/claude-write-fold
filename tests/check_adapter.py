"""Test the adapter against a locally installed, unmodified Windows executable."""
from pathlib import Path
import argparse
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import inject


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', help='Unmodified native claude.exe; defaults to the recorded original')
    args = parser.parse_args()
    source = inject.original_for(inject.source_path(args.source))
    node = shutil.which('node.exe') or shutil.which('node')
    inject.require(node, 'Node.js 20+ is required.')
    info = inject.graph_info(source.read_bytes())
    selected = inject.select_modules(info)
    with tempfile.TemporaryDirectory(prefix='write-fold-tests-') as directory:
        inputs = []
        for kind in ('grouping', 'renderer', 'focus', 'clock'):
            fields = selected[kind]['fields']
            target = Path(directory)/(kind+'.mjs')
            target.write_bytes(info['graph'][fields[2]:fields[2]+fields[3]])
            inputs.append(str(target))
        result = subprocess.run([node, '--expose-gc', str(ROOT/'tests/test-adapter.mjs'), *inputs], timeout=180)
        return result.returncode


if __name__ == '__main__':
    sys.exit(main())
