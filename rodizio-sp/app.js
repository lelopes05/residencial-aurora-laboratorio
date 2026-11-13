'use strict';
let RADARES=window.RADARES_RODIZIO||[];
const map=L.map('map',{zoomControl:false,rotate:true,bearing:0,rotateControl:false,touchRotate:false,dragRotate:false}).setView([-23.5639,-46.6518],13);
L.control.zoom({position:'bottomright'}).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxZoom:19,attribution:'© OpenStreetMap contributors'
}).addTo(map);
const cameraLayer=L.layerGroup().addTo(map);
function renderRadarMarkers(points){
  if(!Array.isArray(points)||points.length<200||points.length>1500)return false;
  RADARES=points;
  cameraLayer.clearLayers();
  for(const camera of RADARES){
    L.circleMarker([camera[0],camera[1]],{
      radius:3.4,weight:1,color:'#a62e27',fillColor:'#e04a3a',fillOpacity:.9
    }).bindPopup('Ponto cadastrado como fiscalização de rodízio. Fonte declarada: CET-SP via Pardal.').addTo(cameraLayer);
  }
  document.getElementById('count').textContent=RADARES.length+' pontos de rodízio';
  return true;
}
renderRadarMarkers(RADARES);

let origin=null,destination=null,originMark=null,destinationMark=null;
let pickMode=null,awaiting=false,resultsField=null;
const routeLayers={};
const searchBusy={origin:false,destination:false};
const searchTimers={origin:null,destination:null};
const searchSent={origin:null,destination:null};
const inputFor=field=>document.getElementById(field==='origin'?'originInput':'destinationInput');
const buttonFor=field=>document.getElementById(field==='origin'?'originBtn':'destinationBtn');
const setStatus=s=>{document.getElementById('status').textContent=s;};
const labelOf=p=>p[0].toFixed(5)+', '+p[1].toFixed(5);

window.setNativeStatus=function(s){
  if(s.includes('Motor BRouter integrado')){
    document.getElementById('engineBadge').textContent='Rotas offline';
    document.getElementById('engineBadge').style.background='#0b655b';
  }else if(s.includes('Erro')){
    document.getElementById('engineBadge').textContent='Motor indisponível';
  }else{
    document.getElementById('engineBadge').textContent='Preparando...';
  }
  if(!awaiting)setStatus(s);
};
function removeRouteLayers(){
  for(const key of Object.keys(routeLayers)){
    map.removeLayer(routeLayers[key]);delete routeLayers[key];
  }
}
function makeMark(p,color){
  return L.circleMarker(p,{
    radius:8,color:'#fff',weight:2,fillColor:color,fillOpacity:1
  }).addTo(map);
}
function setPoint(field,p,label){
  removeRouteLayers();
  if(field==='origin'){
    if(originMark)map.removeLayer(originMark);
    origin=p;originMark=makeMark(p,'#2164aa');
  }else{
    if(destinationMark)map.removeLayer(destinationMark);
    destination=p;destinationMark=makeMark(p,'#07856b');
  }
  inputFor(field).value=label||labelOf(p);
  pickMode=null;updatePickButtons();closeResults();
  if(origin&&destination){
    map.fitBounds(L.latLngBounds([origin,destination]).pad(.3),{maxZoom:16,animate:true});
    setStatus('Origem e destino definidos. Calcule uma das rotas.');
  }else{
    map.setView(p,15);
    setStatus(field==='origin'?'Origem definida. Escolha o destino.':'Destino definido. Escolha a origem.');
  }
}
function invalidatePoint(field){
  removeRouteLayers();
  if(field==='origin'){
    if(originMark)map.removeLayer(originMark);
    originMark=null;origin=null;
  }else{
    if(destinationMark)map.removeLayer(destinationMark);
    destinationMark=null;destination=null;
  }
}
function updatePickButtons(){
  document.getElementById('originMapBtn').classList.toggle('active',pickMode==='origin');
  document.getElementById('destinationMapBtn').classList.toggle('active',pickMode==='destination');
}
function pickOnMap(field){
  closeResults();
  document.activeElement.blur();
  pickMode=field;
  updatePickButtons();
  setStatus('Toque no mapa para definir '+(field==='origin'?'a origem.':'o destino.'));
}
map.on('click',e=>{
  let field=pickMode;
  if(!field)field=!origin?'origin':'destination';
  setPoint(field,[e.latlng.lat,e.latlng.lng],null);
});
function clearSelection(){
  removeRouteLayers();
  if(originMark)map.removeLayer(originMark);
  if(destinationMark)map.removeLayer(destinationMark);
  origin=null;destination=null;originMark=null;destinationMark=null;
  pickMode=null;awaiting=false;
  inputFor('origin').value='';inputFor('destination').value='';
  updatePickButtons();closeResults();
  setStatus('Digite um endereço, use o GPS ou escolha pontos no mapa.');
}
function km(a,b){
  const d=Math.PI/180;
  const dx=(b[0]-a[0])*d,dy=(b[1]-a[1])*d;
  const v=Math.sin(dx/2)**2+
    Math.cos(a[0]*d)*Math.cos(b[0]*d)*Math.sin(dy/2)**2;
  return 12742*Math.asin(Math.sqrt(Math.min(1,v)));
}
function calculate(avoid){
  closeResults();
  document.activeElement.blur();
  if(!origin||!destination){
    setStatus('Defina a origem e o destino por endereço, GPS ou pelo mapa.');return;
  }
  if(awaiting){setStatus('Aguarde o cálculo anterior.');return;}
  if(!window.RodizioAndroid){setStatus('Roteador Android indisponível.');return;}
  let near=[];
  if(avoid){
    const loLat=Math.min(origin[0],destination[0])-.025;
    const hiLat=Math.max(origin[0],destination[0])+.025;
    const loLon=Math.min(origin[1],destination[1])-.025;
    const hiLon=Math.max(origin[1],destination[1])+.025;
    near=RADARES.filter(c=>c[0]>=loLat&&c[0]<=hiLat&&c[1]>=loLon&&c[1]<=hiLon
      &&km(c,origin)>.07&&km(c,destination)>.07);
  }
  const nogos=near.map(c=>c[1]+','+c[0]+',35').join('|');
  awaiting=true;
  setStatus('Calculando offline '+(avoid?'alternativa com '+near.length+' pontos a evitar':'rota comum')+'...');
  try{
    RodizioAndroid.calcular(origin[0],origin[1],destination[0],destination[1],avoid,nogos);
  }catch(e){
    awaiting=false;setStatus('Falha ao calcular rota: '+e.message);
  }
}
window.onRouteError=function(message){awaiting=false;setStatus(message);};
window.onRouteResult=function(raw,avoid){
  awaiting=false;
  try{
    const result=JSON.parse(raw),key=avoid?'alternate':'common';
    if(routeLayers[key])map.removeLayer(routeLayers[key]);
    routeLayers[key]=L.geoJSON(result,{style:{
      color:avoid?'#07856b':'#1764ad',weight:5,opacity:.87
    }}).addTo(map);
    const bounds=routeLayers[key].getBounds();
    if(bounds.isValid())map.fitBounds(bounds.pad(.13),{animate:true});
    let lengthMeters=NaN;
    const properties=result?.features?.[0]?.properties;
    if(properties&&properties['track-length']!==undefined){
      lengthMeters=Number(properties['track-length']);
    }
    if(!Number.isFinite(lengthMeters)){
      const all=[];
      function extract(geometry){
        if(!geometry)return;
        if(geometry.type==='FeatureCollection')return (geometry.features||[]).forEach(extract);
        if(geometry.type==='Feature')return extract(geometry.geometry);
        if(geometry.type==='LineString')all.push(...geometry.coordinates);
        if(geometry.type==='MultiLineString')geometry.coordinates.forEach(x=>all.push(...x));
      }
      extract(result);
      lengthMeters=0;
      for(let i=1;i<all.length;i++)
        lengthMeters+=1000*km([all[i-1][1],all[i-1][0]],[all[i][1],all[i][0]]);
    }
    const secs=Number(properties?.['total-time']);
    const eta=Number.isFinite(secs)&&secs>0?' · ~'+Math.max(1,Math.round(secs/60))+' min estimados':'';
    setStatus((avoid?'Alternativa':'Rota comum')+' calculada: '+
      (lengthMeters/1000).toFixed(2)+' km'+eta+'. Compare as linhas no mapa.');
  }catch(e){setStatus('Falha ao desenhar trajeto: '+e.message);}
};
window.onNativeLocation=function(lat,lon){
  if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
  setPoint('origin',[lat,lon],'Minha localização');
};
function getGPS(){
  closeResults();
  if(window.RodizioAndroid){
    setStatus('Obtendo sua localização atual...');
    RodizioAndroid.minhaLocalizacao();
  }else setStatus('GPS disponível somente no APK.');
}
function closeResults(){
  const box=document.getElementById('resultsBox');
  box.hidden=true;box.replaceChildren();
  resultsField=null;
}
function scheduleLiveSearch(field){
  if(searchTimers[field])clearTimeout(searchTimers[field]);
  if(inputFor(field).value.trim().length<3){closeResults();return;}
  searchTimers[field]=setTimeout(()=>searchAddress(field,true),750);
}
function searchAddress(field,live=false){
  if(searchTimers[field])clearTimeout(searchTimers[field]);
  if(searchBusy[field])return;
  const query=inputFor(field).value.trim();
  if(query.length<3){
    if(!live)setStatus('Digite pelo menos 3 caracteres para buscar.');
    return;
  }
  if(!window.RodizioAndroid){
    if(!live)setStatus('Busca exige o aplicativo Android.');
    return;
  }
  if(!live)document.activeElement.blur();
  searchBusy[field]=true;
  searchSent[field]=query;
  buttonFor(field).disabled=true;
  if(!live)closeResults();
  setStatus('Buscando sugestões para '+(field==='origin'?'origem':'destino')+'...');
  try{RodizioAndroid.buscar(field,query);}
  catch(e){window.onSearchError(field,e.message);}
}
window.onSearchError=function(field,message){
  searchBusy[field]=false;buttonFor(field).disabled=false;
  if(inputFor(field).value.trim()!==searchSent[field]){
    scheduleLiveSearch(field);return;
  }
  setStatus(message);
};
window.onSearchResults=function(field,raw){
  searchBusy[field]=false;buttonFor(field).disabled=false;
  if(inputFor(field).value.trim()!==searchSent[field]){
    scheduleLiveSearch(field);return;
  }
  let entries=[];
  try{entries=JSON.parse(raw);}catch(e){
    setStatus('Resposta de endereços inválida.');return;
  }
  if(!entries.length){setStatus('Nenhum resultado encontrado. Tente incluir bairro e cidade.');return;}
  const box=document.getElementById('resultsBox');
  box.replaceChildren();
  resultsField=field;
  for(const item of entries){
    const lat=Number(item.lat),lon=Number(item.lon);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    const full=String(item.display_name||'Local encontrado');
    const first=full.split(',').slice(0,2).join(',').trim();
    const b=document.createElement('button');b.type='button';b.className='result';
    const title=document.createElement('strong');title.textContent=first;
    const detail=document.createElement('small');detail.textContent=full;
    b.append(title,detail);
    b.onclick=()=>setPoint(field,[lat,lon],first);
    box.appendChild(b);
  }
  box.hidden=false;
  setStatus('Toque no resultado correto para definir '+(field==='origin'?'a origem.':'o destino.'));
};
for(const field of ['origin','destination']){
  const input=inputFor(field);
  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();searchAddress(field);}
  });
  input.addEventListener('input',()=>{
    invalidatePoint(field);closeResults();
    if(input.value.trim().length>=3){
      setStatus('Buscando endereços enquanto você digita...');
      scheduleLiveSearch(field);
    }else setStatus('Digite pelo menos três caracteres.');
  });
}
