'use strict';

/* Rodízio SP — ponte para Safari/iOS. Toda a navegação e os favoritos continuam
 * no aparelho; o roteamento e as buscas são chamados pela internet. */
(function(){
  const ROUTER='https://brouter.de/brouter';
  const PHOTON='https://photon.komoot.io/api/';
  const RADAR_CSV='https://raw.githubusercontent.com/Murkiriel/pardal/main/estados/SP/cameras_fiscalizacao.csv';
  const radarKey='rodizio-sp-radares-web-v1';
  const radarDateKey='rodizio-sp-radares-web-check-v1';
  const voiceSupported=typeof speechSynthesis!=='undefined';
  let watchId=null;
  let navActive=false,navStarted=false,lastFix=null;
  let voices=null;
  const status=text=>{
    if(document.getElementById('status'))document.getElementById('status').textContent=text;
  };
  function error(text){
    if(typeof window.onRouteError==='function')window.onRouteError(text);
    else status(text);
  }
  function searchError(field,text){
    if(typeof window.onSearchError==='function')window.onSearchError(field,text);
    else status(text);
  }
  async function jsonGet(url,signal){
    const res=await fetch(url,{signal,headers:{Accept:'application/json'}});
    if(!res.ok)throw new Error('Serviço respondeu '+res.status);
    return res.json();
  }
  function asyncTimeout(ms){
    const ctl=new AbortController();
    const timeout=setTimeout(()=>ctl.abort(),ms);
    return {signal:ctl.signal,done:()=>clearTimeout(timeout)};
  }
  function pointDistance(a,b){
    const lat=((a[0]+b[0])/2)*Math.PI/180;
    return Math.hypot((a[0]-b[0])*111110,(a[1]-b[1])*111110*Math.cos(lat));
  }
  function bearing(a,b){
    const lat=((a[0]+b[0])/2)*Math.PI/180;
    return (Math.atan2((b[1]-a[1])*Math.cos(lat),b[0]-a[0])*180/Math.PI+360)%360;
  }
  function locationError(e){
    const msg=e&&e.code===1?'Permissão de localização negada.':
      e&&e.code===2?'Localização não disponível.':'O GPS demorou para responder.';
    if(navActive&&window.onNavigationError)window.onNavigationError(msg);
    else error(msg+' Você também pode escolher o ponto no mapa.');
  }
  function locationData(pos){
    const c=pos.coords;
    const point=[c.latitude,c.longitude];
    let speed=Number.isFinite(c.speed)?c.speed:-1;
    let direction=Number.isFinite(c.heading)?c.heading:-1;
    if(lastFix){
      const meters=pointDistance(lastFix.point,point);
      const deltaMs=Math.max(1,pos.timestamp-lastFix.time);
      if(speed<0)speed=meters*1000/deltaMs;
      if(direction<0&&meters>9&&deltaMs<18000)direction=bearing(lastFix.point,point);
    }
    lastFix={point,time:pos.timestamp};
    return {point,accuracy:Number.isFinite(c.accuracy)?c.accuracy:100,bearing:direction,speed};
  }
  function unlockVoice(){
    if(!voiceSupported)return;
    try{
      // A ativação acontece no clique que começa a navegação.
      speechSynthesis.resume();
      const vs=speechSynthesis.getVoices();
      voices=vs.find(v=>/pt[-_]BR/i.test(v.lang))||vs.find(v=>/^pt/i.test(v.lang))||null;
    }catch(_e){}
  }
  function speak(text,radar=false){
    if(!voiceSupported||!navActive)return;
    try{
      const msg=new SpeechSynthesisUtterance(text);
      msg.lang='pt-BR';msg.rate=1.04;
      if(voices)msg.voice=voices;
      if(!radar)speechSynthesis.cancel();
      speechSynthesis.speak(msg);
    }catch(_e){}
  }
  function normalizePhoton(features){
    return (features||[]).map(f=>{
      const p=f.properties||{},g=f.geometry||{},c=g.coordinates;
      if(!Array.isArray(c)||c.length<2)return null;
      const name=p.name||p.street||'Local';
      const parts=[name];
      if(p.housenumber&&!name.includes(p.housenumber))parts.push(p.housenumber);
      if(p.street&&p.street!==name)parts.push(p.street);
      if(p.district)parts.push(p.district);
      if(p.city)parts.push(p.city);
      return {lat:Number(c[1]),lon:Number(c[0]),display_name:parts.join(', ')};
    }).filter(x=>x&&Number.isFinite(x.lat)&&Number.isFinite(x.lon));
  }
  function cameraList(csv){
    const points=[],seen=new Set();
    for(const line of csv.split(/\r?\n/)){
      const f=line.trim().split(',');
      if(f.length!==5||f[2]!=='ROAD_ROTATION'||f[3]!=='CET-SP:CAM'||f[4]!=='1')continue;
      const lat=Number(f[0]),lon=Number(f[1]);
      if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
      if(lat< -24.2||lat> -23.2||lon< -47.2||lon> -46.1)continue;
      const key=lat.toFixed(6)+','+lon.toFixed(6);
      if(seen.has(key))continue;
      seen.add(key);points.push([lat,lon]);
    }
    if(points.length<200||points.length>1500)throw new Error('Quantidade inesperada: '+points.length);
    return points;
  }
  async function refreshRadars(manual){
    if(!manual&&Date.now()-(Number(localStorage.getItem(radarDateKey))||0)<24*3600e3)return;
    const t=asyncTimeout(20000);
    try{
      const res=await fetch(RADAR_CSV,{signal:t.signal,cache:'no-store'});
      if(!res.ok)throw new Error('Fonte respondeu '+res.status);
      const points=cameraList(await res.text());
      localStorage.setItem(radarKey,JSON.stringify(points));
      localStorage.setItem(radarDateKey,String(Date.now()));
      if(typeof window.onRadarUpdateData==='function')window.onRadarUpdateData(JSON.stringify(points));
      if(manual&&window.onRadarUpdateMessage)
        window.onRadarUpdateMessage('Lista do Pardal verificada: '+points.length+' pontos.');
    }catch(e){
      if(manual&&window.onRadarUpdateMessage)
        window.onRadarUpdateMessage('Não foi possível verificar os radares; mantida a lista anterior.');
    }finally{t.done();}
  }
  window.RodizioAndroid={
    calcular:async(lat1,lon1,lat2,lon2,avoid,nogos)=>{
      const t=asyncTimeout(50000);
      try{
        const params=new URLSearchParams({
          lonlats:lon1+','+lat1+'|'+lon2+','+lat2,
          profile:'car-fast',format:'geojson',timode:'3'
        });
        if(avoid&&nogos){
          // Limita a URL para evitar rejeição do servidor; mantém os mais próximos da linha.
          const from=[lat1,lon1],to=[lat2,lon2];
          const pointPenalty=s=>{
            const f=s.split(',');
            const p=[Number(f[1]),Number(f[0])];
            if(!p.every(Number.isFinite))return Infinity;
            return Math.min(pointDistance(from,p),pointDistance(to,p));
          };
          const sorted=nogos.split('|').sort((a,b)=>pointPenalty(a)-pointPenalty(b));
          params.set('nogos',sorted.slice(0,65).join('|'));
        }
        const route=await jsonGet(ROUTER+'?'+params.toString(),t.signal);
        if(!route||!Array.isArray(route.features)||!route.features.length)throw Error('Nenhuma rota encontrada.');
        window.onRouteResult(JSON.stringify(route),!!avoid);
      }catch(e){
        error(e.name==='AbortError'?'Tempo limite do servidor BRouter.':
          'Rota online indisponível: '+e.message);
      }finally{t.done();}
    },
    buscar:async(field,query)=>{
      const t=asyncTimeout(20000);
      try{
        const q=new URLSearchParams({q:query,lat:'-23.56',lon:'-46.65',limit:'8',
          bbox:'-47.20,-24.10,-45.90,-22.90'});
        const data=await jsonGet(PHOTON+'?'+q.toString(),t.signal);
        window.onSearchResults(field,JSON.stringify(normalizePhoton(data.features)));
      }catch(e){searchError(field,'Busca indisponível. Escolha o ponto no mapa.');}
      finally{t.done();}
    },
    procurarPerto:async(kind,lat,lon)=>{
      const t=asyncTimeout(25000);
      try{
        const q=new URLSearchParams({q:kind==='fuel'?'auto posto':'hospital',
          lat:String(lat),lon:String(lon),limit:'45'});
        const data=await jsonGet(PHOTON+'?'+q.toString(),t.signal);
        const list=(data.features||[]).filter(f=>
          f.properties?.osm_key==='amenity'&&f.properties?.osm_value===kind)
          .map(f=>{
            const p=f.properties,c=f.geometry?.coordinates;
            if(!Array.isArray(c))return null;
            const dist=pointDistance([lat,lon],[c[1],c[0]])/1000;
            return {lat:c[1],lon:c[0],
              display_name:(p.name||'Local')+', '+(p.district||p.city||'São Paulo'),
              distance_km:dist};
          }).filter(Boolean).sort((a,b)=>a.distance_km-b.distance_km).slice(0,12);
        window.onNearbyResults(kind,JSON.stringify(list));
      }catch(e){window.onNearbyError(kind,'Consulta de locais indisponível.');}
      finally{t.done();}
    },
    atualizarRadares:()=>refreshRadars(true),
    minhaLocalizacao:()=>{
      if(!navigator.geolocation){error('Safari sem acesso ao GPS.');return;}
      navigator.geolocation.getCurrentPosition(pos=>{
        const c=pos.coords;
        window.onNativeLocation(c.latitude,c.longitude);
      },locationError,{enableHighAccuracy:true,maximumAge:12000,timeout:18000});
    },
    iniciarNavegacao:()=>{
      if(watchId!==null)return;
      if(!navigator.geolocation){window.onNavigationError('Localização não disponível neste navegador.');return;}
      unlockVoice();
      navActive=true;navStarted=false;
      watchId=navigator.geolocation.watchPosition(pos=>{
        if(!navActive)return;
        const loc=locationData(pos);
        if(!navStarted){
          navStarted=true;
          window.onNavigationStarted();
        }
        window.onNavigationLocation(loc.point[0],loc.point[1],
          loc.accuracy,loc.bearing,loc.speed);
      },e=>{
        locationError(e);
        if(!navStarted&&e.code===1){
          navActive=false;
          navigator.geolocation.clearWatch(watchId);
          watchId=null;
        }
      },{enableHighAccuracy:true,maximumAge:1000,timeout:20000});
    },
    pararNavegacao:()=>{
      navActive=false;navStarted=false;
      if(watchId!==null&&navigator.geolocation)navigator.geolocation.clearWatch(watchId);
      watchId=null;
      if(voiceSupported)speechSynthesis.cancel();
    },
    falar:text=>speak(text,false),
    falarRadar:text=>speak(text,true)
  };
  window.addEventListener('DOMContentLoaded',()=>{
    const badge=document.getElementById('engineBadge');
    if(badge)badge.textContent='Mapa · GPS · rotas online';
    if(window.setNativeStatus)window.setNativeStatus('Modo iPhone: BRouter online. Digite o destino, use GPS ou toque no mapa.');
    let saved=null;
    try{saved=localStorage.getItem(radarKey)}catch(_e){}
    if(saved&&typeof window.onRadarUpdateData==='function')window.onRadarUpdateData(saved);
    refreshRadars(false);
    if('serviceWorker'in navigator){
      navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{});
    }
  });
})();
