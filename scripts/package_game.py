from pathlib import Path
import base64,json,zipfile
root=Path(__file__).resolve().parents[1];dist=root/'dist'
output=root/'build';output.mkdir(exist_ok=True)
js=(dist/'game.js').read_text()
assets=list(json.loads((dist/'assets/actors.json').read_text()).values())+json.loads((dist/'assets/backgrounds.json').read_text())
for item in assets:
 src=item['src'];assert src in js
 js=js.replace(src,'data:image/png;base64,'+base64.b64encode((dist/src).read_bytes()).decode())
html=(dist/'index.html').read_text().replace('<link rel="stylesheet" href="style.css">','<style>'+(dist/'style.css').read_text()+'</style>').replace('<script src="game.js"></script>','<script>'+js+'</script>')
assert 'src="game.js"' not in html and 'assets/carl' not in html and 'assets/donut' not in html
(output/'Dungeon-Broadcast.html').write_text(html)
with zipfile.ZipFile(output/'dungeon-broadcast-source.zip','w',zipfile.ZIP_DEFLATED) as z:
 for folder in ['dist','tests','scripts']:
  for file in sorted((root/folder).rglob('*')):
   if file.is_file():z.write(file,Path('dungeon-broadcast')/file.relative_to(root))
 for name in ['README.txt','ARTWORK.txt']:z.write(root/name,Path('dungeon-broadcast')/name)
print('Standalone size:',len(html),'bytes; all seven actor atlases and five hallway images embedded.')
