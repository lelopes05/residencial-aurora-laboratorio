'use strict';

// Área do rodízio: geometria do minianel da CET-SP (arquivo SHP publicado em 2019).
const rodizioBoundary=window.MINIANEL_RODIZIO||[];
let rodizioPolygon=null,rodizioVisible=false;
let zoneLastInside=null;
const zoneEl=id=>document.getElementById(id);
function zoneContains(point){
  if(!point||rodizioBoundary.length<3)return false;
  let inside=false;
  const lat=point[0],lon=point[1],poly=rodizioBoundary;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j];
    if((a[0]>lat)!==(b[0]>lat)&&
      lon<(b[1]-a[1])*(lat-a[0])/(b[0]-a[0])+a[1])inside=!inside;
  }
  return inside;
}
function zoneLocation(){
  return nav?.active&&nav?.lastFix?.point ? nav.lastFix.point :
    origin || (nav?.lastFix?.point||null);
}
function renderZoneStatus(){
  if(!rodizioVisible)return;
  zoneEl('zoneCard').hidden=false;
  const point=zoneLocation();
  if(!point){
    zoneEl('zoneIndicator').textContent='Área do rodízio';
    zoneEl('zoneDetail').textContent='Use o GPS ou escolha uma origem.';
    zoneEl('exitZoneBtn').hidden=true;
    return;
  }
  const inside=zoneContains(point);
  zoneLastInside=inside;
  zoneEl('zoneIndicator').textContent=inside?'DENTRO da área de rodízio':'FORA da área de rodízio';
  zoneEl('zoneIndicator').style.color=inside?'#af283b':'#16705a';
  zoneEl('zoneDetail').textContent=inside?
    'Área restrita em dias e horários de rodízio.':
    'Sua posição está fora do minianel.';
  zoneEl('exitZoneBtn').hidden=!inside;
}
function toggleRodizioArea(){
  if(rodizioBoundary.length<3){
    setStatus('Limite do rodízio indisponível.');return;
  }
  rodizioVisible=!rodizioVisible;
  zoneEl('zoneToggle').classList.toggle('active',rodizioVisible);
  zoneEl('zoneToggle').textContent=rodizioVisible?'Área ✓':'Área';
  if(rodizioVisible){
    if(!rodizioPolygon){
      rodizioPolygon=L.polygon(rodizioBoundary,{
        color:'#b52a3e',weight:2.2,fillColor:'#e34458',
        fillOpacity:.20,opacity:.83,interactive:false
      });
    }
    rodizioPolygon.addTo(map).bringToBack();
    renderZoneStatus();
    if(!nav.active&&!origin&&!destination)
      map.fitBounds(rodizioPolygon.getBounds().pad(.08),{maxZoom:12,animate:true});
  }else{
    if(rodizioPolygon)map.removeLayer(rodizioPolygon);
    zoneEl('zoneCard').hidden=true;
  }
}
function findOutsidePoint(point){
  if(!zoneContains(point))return null;
  const centerLat=point[0]*Math.PI/180;
  const xScale=111320*Math.cos(centerLat),yScale=110960;
  let closest=null;
  let distance=Infinity;
  for(let i=0;i<rodizioBoundary.length-1;i++){
    const a=rodizioBoundary[i],b=rodizioBoundary[i+1];
    const ax=(a[1]-point[1])*xScale,ay=(a[0]-point[0])*yScale;
    const bx=(b[1]-point[1])*xScale,by=(b[0]-point[0])*yScale;
    const vx=bx-ax,vy=by-ay,len=vx*vx+vy*vy;
    const t=len?Math.max(0,Math.min(1,-(ax*vx+ay*vy)/len)):0;
    const cx=ax+t*vx,cy=ay+t*vy;
    const d=Math.hypot(cx,cy);
    if(d<distance&&d>1){
      distance=d;closest={point:[point[0]+cy/yScale,point[1]+cx/xScale], dx:cx/d,dy:cy/d};
    }
  }
  if(!closest)return null;
  // Avança para fora do polígono além da borda, para o BRouter encontrar uma rua pública.
  for(const meters of [280,450,650,1000,1500,2500]){
    const result=[
      closest.point[0]+closest.dy*meters/yScale,
      closest.point[1]+closest.dx*meters/xScale
    ];
    if(!zoneContains(result))return result;
  }
  return null;
}
function routeOutOfZone(){
  if(!window.RodizioAndroid){setStatus('Roteamento requer o APK Android.');return;}
  const point=zoneLocation();
  if(!point){getGPS();setStatus('Aguarde o GPS; toque em Traçar saída novamente.');return;}
  const exit=findOutsidePoint(point);
  if(!exit){
    setStatus('Não foi possível determinar uma saída. Selecione um ponto fora da área.');
    return;
  }
  setPoint('origin',point,'Sua posição');
  setPoint('destination',exit,'Fora da área de rodízio');
  if(!zoneContains(exit)){
    setStatus('Calculando uma rota até fora do minianel; a saída é aproximada.');
    calculate(true);
  }
}
const origOnNativeLocation=window.onNativeLocation;
window.onNativeLocation=function(lat,lon){
  origOnNativeLocation(lat,lon);
  if(rodizioVisible)renderZoneStatus();
};
const origOnNavigationLocation=window.onNavigationLocation;
window.onNavigationLocation=function(lat,lon,accuracy,bearing,speed){
  origOnNavigationLocation(lat,lon,accuracy,bearing,speed);
  if(rodizioVisible)renderZoneStatus();
};
const origSetPoint=window.setPoint;
window.setPoint=function(field,point,label){
  origSetPoint(field,point,label);
  if(rodizioVisible)renderZoneStatus();
};

// Favoritos persistentes no armazenamento privado do WebView.
const favKey='rodizio-sp-favoritos-v1';
let favorites=[];
try{
  const stored=JSON.parse(localStorage.getItem(favKey)||'[]');
  if(Array.isArray(stored)){
    favorites=stored.filter(x=>
      typeof x.name==='string'&&x.name.length<=45&&
      Array.isArray(x.p)&&x.p.length===2&&
      Number.isFinite(x.p[0])&&Number.isFinite(x.p[1])
    ).slice(0,60);
  }
}catch(_e){}
let favoriteCandidate=null;
function persistFavorites(){
  try{localStorage.setItem(favKey,JSON.stringify(favorites));}
  catch(e){setStatus('Não foi possível armazenar o favorito: '+e.message);}
}
function renderFavorites(){
  const list=zoneEl('favoritesList');
  list.replaceChildren();
  if(!favorites.length){
    const message=document.createElement('small');
    message.textContent='Sem favoritos. Escolha um destino e toque em + Salvar.';
    list.append(message);return;
  }
  for(const item of favorites){
    const wrap=document.createElement('span');
    wrap.className='favItem';
    const select=document.createElement('button');
    select.textContent='★ '+item.name;
    select.onclick=()=>{
      setPoint('destination',item.p.slice(),item.name);
      zoneEl('favoritesPanel').hidden=true;
      setStatus('Favorito selecionado: '+item.name);
    };
    const remove=document.createElement('button');
    remove.className='remove';remove.textContent='×';
    remove.setAttribute('aria-label','Excluir '+item.name);
    remove.onclick=()=>{
      favorites=favorites.filter(x=>x!==item);
      persistFavorites();renderFavorites();
    };
    wrap.append(select,remove);list.append(wrap);
  }
}
function toggleFavorites(){
  const box=zoneEl('favoritesPanel');
  box.hidden=!box.hidden;
  if(!box.hidden)renderFavorites();
}
function startSaveFavorite(){
  favoriteCandidate=destination?destination.slice():(origin?origin.slice():null);
  if(!favoriteCandidate){
    setStatus('Selecione um destino ou uma origem para salvar.');return;
  }
  zoneEl('favoritesPanel').hidden=false;
  zoneEl('favoriteEditor').hidden=false;
  zoneEl('favoritePointHint').textContent=destination?'Salvando destino selecionado.':'Salvando origem selecionada.';
  zoneEl('favoriteNameInput').value=destination?
    (inputFor('destination').value||''):(inputFor('origin').value||'');
  zoneEl('favoriteNameInput').focus();
  renderFavorites();
}
function favoriteName(name){
  zoneEl('favoriteNameInput').value=name;
}
function cancelSaveFavorite(){
  favoriteCandidate=null;
  zoneEl('favoriteEditor').hidden=true;
}
function saveFavorite(){
  if(!favoriteCandidate)return;
  const name=zoneEl('favoriteNameInput').value.trim();
  if(!name){setStatus('Digite um nome para o favorito.');return;}
  favorites=favorites.filter(x=>x.name.toLowerCase()!==name.toLowerCase());
  favorites.unshift({name:name.slice(0,45),p:favoriteCandidate.slice()});
  favorites=favorites.slice(0,60);
  persistFavorites();renderFavorites();
  zoneEl('favoriteEditor').hidden=true;
  zoneEl('favoriteNameInput').blur();
  favoriteCandidate=null;
  setStatus('Favorito salvo neste aparelho: '+name);
}
renderFavorites();

// Busca de serviços próximos — resultados classificados do OSM.
let nearbyWaiting=false;
function searchNearby(kind){
  if(nearbyWaiting)return;
  closeResults();
  const point=nav?.lastFix?.point||origin||[map.getCenter().lat,map.getCenter().lng];
  const label=kind==='fuel'?'postos de gasolina':'hospitais';
  if(!window.RodizioAndroid?.procurarPerto){
    setStatus('Busca de serviços requer a nova versão do APK.');return;
  }
  nearbyWaiting=true;
  setStatus('Buscando '+label+' perto do ponto escolhido...');
  RodizioAndroid.procurarPerto(kind,point[0],point[1]);
}
window.onNearbyResults=function(kind,raw){
  nearbyWaiting=false;
  let places;
  try{places=JSON.parse(raw);}catch(e){setStatus('Resultados de serviços inválidos.');return;}
  if(!places.length){
    setStatus('Nenhum local cadastrado encontrado. Busque por endereço ou no mapa.');
    return;
  }
  const box=zoneEl('resultsBox');
  box.replaceChildren();
  for(const item of places){
    const lat=Number(item.lat),lon=Number(item.lon),dist=Number(item.distance_km);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    const name=String(item.display_name||'Local');
    const button=document.createElement('button');button.className='result';
    const title=document.createElement('strong');title.textContent=name.split(',').slice(0,2).join(',');
    const meta=document.createElement('small');
    meta.textContent=(Number.isFinite(dist)?dist.toFixed(1).replace('.',',')+' km em linha reta · ':'')+'Toque para definir destino';
    button.append(title,meta);
    button.onclick=()=>setPoint('destination',[lat,lon],name.split(',')[0]);
    box.append(button);
  }
  box.hidden=false;
  setStatus('Resultados do OpenStreetMap. Confirme a localização antes de partir.');
};
window.onNearbyError=function(kind,message){
  nearbyWaiting=false;setStatus(message);
};

// Substitui os pontos apenas após validação nativa do CSV completo.
window.onRadarUpdateData=function(raw){
  try{
    const points=JSON.parse(raw);
    if(renderRadarMarkers(points)){
      if(typeof navPrepareRadarWarnings==='function')navPrepareRadarWarnings();
    }
  }catch(e){setStatus('Lista de radares não foi carregada: '+e.message);}
};
window.onRadarUpdateMessage=function(msg){
  zoneEl('refreshRadars').disabled=false;
  setStatus(msg);
};
function refreshRadarPoints(){
  if(!window.RodizioAndroid?.atualizarRadares)return;
  zoneEl('refreshRadars').disabled=true;
  setStatus('Conferindo os radares com o projeto Pardal...');
  RodizioAndroid.atualizarRadares();
}
