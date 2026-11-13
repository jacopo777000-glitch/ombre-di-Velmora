from pathlib import Path
import json
from PIL import Image, ImageChops, ImageDraw

ROOT=Path(".")
EQUIP=ROOT/"assets"/"equip"
PARTS=EQUIP/"modular"
MANIFEST=EQUIP/"manifest.json"

# Coordinate masks on the original 912x1168 outfit sheet.
POLYGONS={
"Armatura_guerriero":{
"armor":[[[450,125],[690,125],[760,225],[790,390],[735,570],[445,570],[390,380]]],
"shoulders":[[[330,160],[470,145],[515,340],[450,420],[330,350]],[[690,145],[835,155],[836,345],[770,420],[680,335]]],
"arms":[[[330,320],[425,340],[465,575],[430,760],[345,760],[320,600]],[[735,320],[835,340],[836,650],[800,760],[715,735],[690,555]]],
"legs":[[[405,535],[590,555],[575,930],[510,1000],[385,920]],[[585,555],[790,535],[815,920],[730,1000],[610,930]]],
"boots":[[[380,875],[555,870],[570,1118],[360,1118]],[[610,870],[810,875],[836,1118],[600,1118]]]},
"Armatura_arciere":{
"armor":[[[390,140],[720,140],[790,370],[730,580],[410,580],[350,350]]],
"shoulders":[[[330,150],[480,130],[520,340],[435,410],[315,340]],[[640,110],[805,100],[805,350],[740,420],[650,330]]],
"arms":[[[315,320],[420,345],[465,575],[430,770],[330,760],[310,580]],[[700,320],[805,340],[805,650],[770,780],[680,740],[660,540]]],
"legs":[[[360,550],[590,570],[570,930],[480,980],[340,900]],[[575,570],[785,550],[805,900],[700,980],[590,930]]],
"boots":[[[330,870],[520,880],[545,1140],[310,1140]],[[590,880],[800,870],[810,1140],[570,1140]]]},
"Armatura_druido":{
"armor":[[[380,200],[720,200],[780,500],[700,700],[390,700],[350,480]]],
"shoulders":[[[160,240],[430,180],[520,400],[380,500],[150,450]],[[610,180],[830,220],[835,470],[720,510],[630,390]]],
"arms":[[[270,360],[420,370],[455,650],[400,820],[260,760],[240,550]],[[650,360],[820,360],[835,730],[770,820],[640,760],[620,550]]],
"legs":[[[350,610],[590,630],[600,1000],[460,1080],[320,980]],[[570,630],[800,610],[820,980],[690,1080],[560,1000]]],
"boots":[[[320,900],[520,920],[560,1130],[300,1130]],[[590,920],[820,900],[835,1130],[570,1130]]]},
"Armatura_mago":{
"armor":[[[360,180],[720,180],[800,510],[730,720],[350,720],[300,480]]],
"shoulders":[[[230,170],[480,150],[530,420],[390,520],[225,440]],[[620,150],[835,170],[835,440],[730,520],[610,420]]],
"arms":[[[250,330],[420,350],[460,680],[400,820],[250,760],[235,550]],[[650,330],[835,350],[835,760],[780,820],[640,680],[620,540]]],
"legs":[[[310,620],[590,640],[600,1040],[440,1100],[280,980]],[[570,640],[810,620],[835,980],[700,1100],[560,1040]]],
"boots":[[[280,930],[500,940],[560,1135],[270,1135]],[[590,940],[820,930],[835,1135],[570,1135]]]}}
def main():
    manifest=json.loads(MANIFEST.read_text(encoding="utf-8"))
    PARTS.mkdir(parents=True,exist_ok=True)
    for stale in PARTS.glob("*.png"): stale.unlink()
    total=0; total_bytes=0
    for style,slots in POLYGONS.items():
        key=style+".JPG"
        entry=manifest.get(key)
        if not entry: raise RuntimeError("Voce manifest mancante: "+key)
        source_path=ROOT/entry["file"]
        source=Image.open(source_path).convert("RGBA")
        if source.size!=(int(entry["width"]),int(entry["height"])):
            raise RuntimeError("Dimensioni incoerenti: "+str(source_path))
        sx,sy=int(entry["x"]),int(entry["y"])
        entry["parts"]={}
        for slot,polys in slots.items():
            entry["parts"][slot]=[]
            for n,poly in enumerate(polys,1):
                pts=[(max(0,min(source.width-1,int(x-sx))),max(0,min(source.height-1,int(y-sy)))) for x,y in poly]
                scale=4
                high=Image.new("L",(source.width*scale,source.height*scale),0)
                ImageDraw.Draw(high).polygon([(x*scale,y*scale) for x,y in pts],fill=255)
                mask=high.resize(source.size,Image.Resampling.LANCZOS)
                rgba=source.copy()
                alpha=ImageChops.multiply(rgba.getchannel("A"),mask)
                rgba.putalpha(alpha)
                bbox=alpha.getbbox()
                if not bbox: raise RuntimeError(f"Maschera vuota: {style}/{slot}/{n}")
                piece=rgba.crop(bbox)
                if piece.width<4 or piece.height<4: raise RuntimeError(f"Parte troppo piccola: {style}/{slot}/{n}")
                name=f"{style}_{slot}_{n:02d}.png"
                out=PARTS/name
                piece.save(out,format="PNG",optimize=True)
                x0,y0,x1,y1=bbox
                entry["parts"][slot].append({
                    "file":f"assets/equip/modular/{name}",
                    "x":sx+x0,"y":sy+y0,"width":x1-x0,"height":y1-y0
                })
                total+=1; total_bytes+=out.stat().st_size
    MANIFEST.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+chr(10),encoding="utf-8")
    print(f"OK: {total} PNG modulari generati ({total_bytes:,} byte)")
    for style in POLYGONS:
        print(style,{slot:len(manifest[style+".JPG"]["parts"][slot]) for slot in POLYGONS[style]})
if __name__=="__main__": main()
