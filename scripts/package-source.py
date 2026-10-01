import pathlib, zipfile
root = pathlib.Path(__file__).resolve().parent.parent
target = root / 'artifacts' / '小狗双人跑酷-源码.zip'
target.parent.mkdir(exist_ok=True)
files = ['package.json', 'pnpm-lock.yaml', 'README.md', '验收记录.md', '云端部署说明.md', 'render.yaml', '.gitignore', '.dockerignore', 'Dockerfile']
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / name, 'puppy-duo-run/' + name)
    for folder in ['public', 'server', 'tests', 'scripts', 'android', 'deploy']:
        for path in (root / folder).rglob('*'):
            rel = path.relative_to(root)
            if not path.is_file() or any(p in ['build', '.gradle', '__pycache__'] for p in rel.parts) or rel.as_posix().startswith('android/app/src/main/assets/') or path.name == 'local.properties':
                continue
            archive.write(path, 'puppy-duo-run/' + rel.as_posix())
print('Source archive created')
