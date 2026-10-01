"""Small adb UI helper for the local prototype emulator; no app-private data access."""
import os, pathlib, re, subprocess, sys, xml.etree.ElementTree as ET
sys.stdout.reconfigure(encoding='utf-8')
ROOT = pathlib.Path(__file__).resolve().parent.parent
SDK = pathlib.Path(os.environ.get('ANDROID_HOME', r'C:\Users\ll\Documents\Codex\2026-09-29\new-chat\work\tools\android-sdk'))
ADB = str(SDK / 'platform-tools' / 'adb.exe')
def adb(*args):
    return subprocess.check_output([ADB, '-s', 'emulator-5554', *args], timeout=30)
def nodes():
    result = adb('shell', 'uiautomator', 'dump', '/sdcard/puppy-ui.xml')
    if b'dumped to' not in result:
        raise SystemExit('UI snapshot unavailable; do not reuse a stale snapshot')
    return ET.fromstring(adb('shell', 'cat', '/sdcard/puppy-ui.xml')).iter('node')
command = sys.argv[1]
if command == 'dump':
    for n in nodes():
        if n.get('text') or n.get('content-desc') or n.get('class') == 'android.widget.EditText':
            print(n.get('class'), n.get('text'), n.get('content-desc'), n.get('bounds'))
elif command == 'tap':
    label = {'server': '单机可玩', 'practice': '进入单机练习 →', 'again': '再来一局 →', 'connect': '连接服务器', 'home': '返回大厅', 'pause': '暂停游戏'}.get(sys.argv[2], sys.argv[2])
    matches = [n for n in nodes() if label in (n.get('text'), n.get('content-desc'))]
    if not matches: raise SystemExit('UI element not found: ' + sys.argv[2])
    l,t,r,b = map(int, re.findall(r'\d+', matches[int(sys.argv[3]) if len(sys.argv)>3 else 0].get('bounds')))
    adb('shell', 'input', 'tap', str((l+r)//2), str((t+b)//2))
elif command == 'shot':
    target = ROOT / 'artifacts' / sys.argv[2]
    target.write_bytes(adb('exec-out', 'screencap', '-p'))
    print(target)
