const PDFDocument=require('pdfkit');
const path=require('path');
const fs=require('fs');

const COLORS={
  ink:'#0B1020',ink2:'#121A2C',muted:'#667085',muted2:'#98A2B3',purple:'#603AEA',purpleSoft:'#F1EDFF',red:'#FF433E',redSoft:'#FFF0EF',green:'#18A979',greenSoft:'#EAFBF5',blue:'#3478F6',line:'#E4E7EC',soft:'#F8F9FC',white:'#FFFFFF',black:'#101828'
};

function rupiah(v){return 'Rp '+new Intl.NumberFormat('id-ID',{maximumFractionDigits:0}).format(Number(v||0));}
function date(v){if(!v)return'-';try{return new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Jakarta'}).format(new Date(v));}catch{return String(v);}}
function safe(v){return String(v??'-').replace(/[\u2013\u2014]/g,'-').replace(/\u2022/g,'-').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');}
function nowText(){return new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jakarta'}).format(new Date())+' WIB';}

function drawBrandHeader(doc,title,subtitle,compact=false){
  const width=doc.page.width;
  const margin=doc.page.margins.left;
  const usable=width-margin-doc.page.margins.right;
  const h=compact?76:104;
  const logo=path.join(__dirname,'../public/img/inkamnet-wordmark-hq.png');
  doc.save();
  doc.rect(0,0,width,h).fill(COLORS.ink);
  doc.rect(0,h-3,width,3).fill(COLORS.purple);
  doc.rect(width*0.72,h-3,width*0.28,3).fill(COLORS.red);
  doc.circle(width-48,26,70).fillOpacity(.08).fill(COLORS.purple).fillOpacity(1);
  if(fs.existsSync(logo)){
    try{doc.image(logo,margin,compact?18:24,{fit:[145,42],align:'left',valign:'center'});}catch{}
  }
  const titleX=Math.max(margin+165,width*0.42);
  const titleW=width-margin-titleX;
  doc.fillColor('#A99BFF').font('Helvetica-Bold').fontSize(7.2).text('PT INKAMNET NEXERA TECHNOLOGY',titleX,compact?15:20,{width:titleW,align:'right',characterSpacing:.7});
  doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(compact?14:18).text(safe(title),titleX,compact?29:37,{width:titleW,align:'right'});
  if(!compact && subtitle){
    doc.fillColor('#C8CEDA').font('Helvetica').fontSize(8).text(safe(subtitle),titleX,62,{width:titleW,align:'right',lineGap:2});
  }
  doc.restore();
  doc.y=h+18;
  // document meta rail
  if(!compact){
    doc.save();
    doc.roundedRect(margin,doc.y,usable,31,7).fill(COLORS.soft);
    doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(7).text('INKAMNET CONTROL CENTER',margin+11,doc.y+10,{width:usable*.44});
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7).text(`Dibuat: ${nowText()}`,margin+usable*.45,doc.y+10,{width:usable*.53,align:'right'});
    doc.restore();
    doc.y+=43;
  }
}

function drawSectionLabel(doc,label){
  const x=doc.page.margins.left;
  doc.fillColor(COLORS.purple).font('Helvetica-Bold').fontSize(7).text(safe(label).toUpperCase(),x,doc.y,{characterSpacing:.8});
  doc.y+=12;
}

function drawSummary(doc,items){
  if(!items.length)return;
  drawSectionLabel(doc,'Ringkasan');
  const x=doc.page.margins.left;
  const total=doc.page.width-doc.page.margins.left-doc.page.margins.right;
  const cols=Math.min(4,Math.max(1,items.length));
  const gap=9;
  const cw=(total-gap*(cols-1))/cols;
  let y=doc.y;
  items.forEach((it,i)=>{
    if(i>0 && i%cols===0){y+=63;}
    const xx=x+(i%cols)*(cw+gap);
    const accent=it.color||COLORS.purple;
    doc.save();
    doc.roundedRect(xx,y,cw,54,9).fillAndStroke(COLORS.white,COLORS.line);
    doc.roundedRect(xx,y,4,54,2).fill(accent);
    doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(6.7).text(safe(it.label),xx+13,y+10,{width:cw-22,characterSpacing:.35});
    doc.fillColor(accent).font('Helvetica-Bold').fontSize(11.2).text(safe(it.value),xx+13,y+28,{width:cw-22,ellipsis:true});
    doc.restore();
  });
  const rows=Math.ceil(items.length/cols);
  doc.y=y+54+18+(rows>1?(rows-1)*63:0);
}

function valueFor(column,row){return typeof column.value==='function'?column.value(row):row[column.key];}
function colorFor(column,row){return typeof column.color==='function'?column.color(row):(column.color||COLORS.black);}

function drawTable(doc,columns,rows,title,subtitle){
  drawSectionLabel(doc,'Detail Data');
  const x=doc.page.margins.left;
  const total=doc.page.width-doc.page.margins.left-doc.page.margins.right;
  const rawWidths=columns.map(c=>Number(c.width||1));
  const sum=rawWidths.reduce((a,b)=>a+b,0)||1;
  const widths=rawWidths.map(v=>v/sum*total);
  const headerH=29;
  const bottomLimit=doc.page.height-doc.page.margins.bottom-28;

  function head(){
    const y=doc.y;
    doc.save();
    doc.roundedRect(x,y,total,headerH,7).fill(COLORS.ink2);
    let xx=x;
    columns.forEach((c,i)=>{
      doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(6.8).text(safe(c.label).toUpperCase(),xx+6,y+9,{width:Math.max(10,widths[i]-12),align:c.align||'left',ellipsis:true});
      xx+=widths[i];
    });
    doc.restore();
    doc.y=y+headerH+2;
  }

  function nextPage(){
    doc.addPage();
    drawBrandHeader(doc,title,subtitle,true);
    head();
  }

  head();
  if(!rows.length){
    doc.save();
    doc.roundedRect(x,doc.y,total,48,7).fillAndStroke(COLORS.soft,COLORS.line);
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8.5).text('Tidak ada data untuk filter yang dipilih.',x+12,doc.y+18,{width:total-24,align:'center'});
    doc.restore();
    doc.y+=58;
    return;
  }

  rows.forEach((row,ri)=>{
    const vals=columns.map(c=>safe(valueFor(c,row)));
    const heights=vals.map((v,i)=>doc.font(columns[i].bold?'Helvetica-Bold':'Helvetica').fontSize(7.15).heightOfString(v,{width:Math.max(20,widths[i]-12),lineGap:1}));
    let rh=Math.max(30,...heights.map(h=>h+14));
    rh=Math.min(rh,86);
    if(doc.y+rh>bottomLimit) nextPage();
    const y=doc.y;
    doc.save();
    if(ri%2===1)doc.rect(x,y,total,rh).fill('#FBFCFE');
    doc.strokeColor(COLORS.line).lineWidth(.6).moveTo(x,y+rh).lineTo(x+total,y+rh).stroke();
    let xx=x;
    columns.forEach((c,i)=>{
      doc.fillColor(colorFor(c,row)).font(c.bold?'Helvetica-Bold':'Helvetica').fontSize(7.15).text(vals[i],xx+6,y+8,{width:Math.max(20,widths[i]-12),height:rh-12,align:c.align||'left',ellipsis:true,lineGap:1});
      xx+=widths[i];
    });
    doc.restore();
    doc.y=y+rh;
  });
}

function drawFooterOnAllPages(doc){
  const range=doc.bufferedPageRange();
  for(let i=0;i<range.count;i++){
    doc.switchToPage(range.start+i);
    const margin=doc.page.margins.left;
    const y=doc.page.height-27;
    const usable=doc.page.width-margin-doc.page.margins.right;
    doc.save();
    doc.strokeColor(COLORS.line).lineWidth(.7).moveTo(margin,y-8).lineTo(margin+usable,y-8).stroke();
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(6.8).text('PT INKAMNET NEXERA TECHNOLOGY',margin,y,{width:usable*.55});
    doc.text(`Halaman ${i+1} / ${range.count}`,margin+usable*.55,y,{width:usable*.45,align:'right'});
    doc.restore();
  }
}

function createReportPdf(res,{title,subtitle,filename,summaryItems=[],columns=[],rows=[],disposition='attachment',layout=null}){
  const resolvedLayout=layout||((columns.length>=6)?'landscape':'portrait');
  const doc=new PDFDocument({size:'A4',layout:resolvedLayout,margins:{top:36,bottom:42,left:36,right:36},bufferPages:true,info:{Title:safe(title),Author:'INKAMNET Control Center',Subject:safe(subtitle||'')}});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`${disposition==='inline'?'inline':'attachment'}; filename="${String(filename).replace(/[\r\n"]/g,'-')}"`);
  doc.pipe(res);
  drawBrandHeader(doc,title,subtitle,false);
  drawSummary(doc,summaryItems);
  drawTable(doc,columns,rows,title,subtitle);
  drawFooterOnAllPages(doc);
  doc.end();
}

module.exports={createReportPdf,rupiah,date,COLORS};
