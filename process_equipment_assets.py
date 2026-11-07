from pathlib import Path
from PIL import Image
from rembg import remove, new_session
import numpy as np, json

ROOT=Path(".")
OUT=ROOT/"assets"/"equip"
OUT.mkdir(parents=True,exist_ok=True)
GROUPS={
 "hair":["Capelli_coda_ciuffi.jpg","Capelli_coda_lunga.jpg","Capelli_lunghi.jpg","Capelli_mossi.jpg","Capelli_rasati_lato.jpg","Capelli_rasta.jpg","Capelli_spettinati.jpg","Capelli_trecce.jpg"],
 "armor":["Armatura_arciere.JPG","Armatura_druido.JPG","Armatura_guerriero.JPG","Armatura_mago.JPG"],
 "headgear":["Cappello_mago.JPG","Cappello_punk.JPG","Elmo_drago.JPG","Elmo_leone.JPG"]
}
session=new_session("u2netp")
manifest={}
for group,files in GROUPS.items():
 for filename in files:
  src=ROOT/filename
  if not src.exists():
   print("SKIP missing",filename); continue
  original=Image.open(src).convert("RGBA")
  cut=remove(original,session=session).convert("RGBA")
  arr=np.array(cut)
  h,w=arr.shape[:2]
  alpha=arr[:,:,3]
  yy,xx=np.indices((h,w))
  if group=="hair":
   rgb=arr[:,:,:3].astype(np.int16)
   r,g,b=rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
   neutral=(np.maximum.reduce([r,g,b])-np.minimum.reduce([r,g,b])<78)
   cool=(r-g<38)&(r-b<58)
   alpha=np.where((yy<int(h*.38))&neutral&cool,alpha,0).astype(np.uint8)
  elif group=="headgear":
   alpha=np.where(yy<int(h*.55),alpha,0).astype(np.uint8)
  # Discard faint segmentation noise and crop tightly around the real artwork.
  alpha=np.where(alpha>18,alpha,0).astype(np.uint8)
  cut.putalpha(Image.fromarray(alpha))
  bbox=cut.getbbox()
  if not bbox:
   print("SKIP empty",filename); continue
  cropped=cut.crop(bbox)
  outname=Path(filename).stem+".png"
  cropped.save(OUT/outname,optimize=True)
  manifest[filename]={"file":"assets/equip/"+outname,"group":group,
    "canvasWidth":w,"canvasHeight":h,"x":bbox[0],"y":bbox[1],
    "width":bbox[2]-bbox[0],"height":bbox[3]-bbox[1]}
  print("DONE",filename,bbox)
(OUT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
print("Processed",len(manifest),"assets")
