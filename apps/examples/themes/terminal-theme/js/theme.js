/**
 * Terminal CLI Theme – Interactive Engine
 * Boot sequence, typing effects, cursor blink, scanlines, matrix mode
 */
(function(){
  var T='terminal-cli';
  
  function init(){
    if(document.documentElement.getAttribute('data-theme')!==T) return;
    initBootSequence();
    initScanlines();
    initCursorBlink();
    initTypingEffect();
    initPrompt();
  }

  function initBootSequence(){
    // Add boot log to splash
    var boot=document.querySelector('.terminal-boot-log');
    if(!boot) return;
    var lines=[
      '[  OK  ] Started IORA Core Service',
      '[  OK  ] Reached target Smart Home Interface',
      '[  OK  ] Listening on /var/run/iora.sock',
      '[  OK  ] 42 entities discovered',
      '[ INFO ] Home Assistant connected',
      '[  OK  ] Started IORA Terminal Edition'
    ];
    lines.forEach(function(l,i){
      setTimeout(function(){
        var el=document.createElement('div');
        el.textContent=l;
        el.style.cssText='opacity:0;animation:terminal-boot-text 0.3s ease forwards;';
        boot.appendChild(el);
      },i*300);
    });
  }

  function initScanlines(){
    var enabled=document.documentElement.style.getPropertyValue('--terminal-scanlines')!=='0';
    if(!enabled) return;
    var s=document.createElement('div');
    s.className='terminal-scanlines-overlay';
    s.style.cssText='position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.02) 2px,rgba(0,0,0,0.02) 4px);pointer-events:none;z-index:9999;';
    document.body.appendChild(s);
  }

  function initCursorBlink(){
    var blink=document.documentElement.style.getPropertyValue('--terminal-cursor-blink');
    if(blink==='0') return;
    var style=document.createElement('style');
    style.textContent='@keyframes cursor-blink{0%,100%{opacity:1}50%{opacity:0}}input:focus,textarea:focus{caret-color:var(--accent,#50fa7b)}';
    document.head.appendChild(style);
  }

  function initTypingEffect(){
    // Type out labels on hover
    document.querySelectorAll('[data-type-effect]').forEach(function(el){
      var text=el.textContent||'';
      el.textContent='';
      el.addEventListener('mouseenter',function(){
        var i=0;
        var int=setInterval(function(){
          if(i<text.length){el.textContent+=text[i];i++;}
          else clearInterval(int);
        },30);
      });
    });
  }

  function initPrompt(){
    // Add PS1 prompt to any .terminal-prompt elements
    document.querySelectorAll('.terminal-prompt').forEach(function(el){
      el.setAttribute('data-prompt','iora@home:~$ ');
    });
  }

  // Matrix rain effect
  function initMatrix(){
    if(document.documentElement.style.getPropertyValue('--terminal-matrix')==='0') return;
    var canvas=document.createElement('canvas');
    canvas.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:0;opacity:0.06;';
    document.body.appendChild(canvas);
    var ctx=canvas.getContext('2d');
    canvas.width=window.innerWidth;
    canvas.height=window.innerHeight;
    var cols=Math.floor(canvas.width/14);
    var drops=[];
    for(var i=0;i<cols;i++) drops[i]=Math.random()*-100;
    var chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+=;:.,/\\|[]{}()<>!?~';
    function draw(){
      ctx.fillStyle='rgba(0,0,0,0.05)';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle='#00ff41';
      ctx.font='12px monospace';
      for(var i=0;i<drops.length;i++){
        var c=chars[Math.floor(Math.random()*chars.length)];
        ctx.fillText(c,i*14,drops[i]*14);
        if(drops[i]*14>canvas.height&&Math.random()>0.975) drops[i]=0;
        drops[i]++;
      }
    }
    setInterval(draw,50);
  }

  document.readyState==='loading'?
    document.addEventListener('DOMContentLoaded',function(){init();initMatrix();}):
    (init(),initMatrix());

  new MutationObserver(function(){init();initMatrix();})
    .observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});

  // ═══════════════════════════════════════════
  // CRT RETRO MONITOR ENGINE
  // ═══════════════════════════════════════════
  
  function initCRT(){
    var root=document.documentElement;
    var crtEnabled=root.style.getPropertyValue('--terminal-crt-effect');
    if(crtEnabled==='0'){removeCRT();return;}
    
    var intensity=parseInt(root.style.getPropertyValue('--terminal-crt-intensity'))||60;
    var curvature=root.style.getPropertyValue('--terminal-crt-curvature');
    
    // CRT Power-On Animation
    root.classList.add('crt-booting');
    setTimeout(function(){root.classList.remove('crt-booting');},800);
    
    // Scanlines (fine)
    createCRTLayer('crt-scanlines-fine','div',{opacity:(intensity/100*0.5).toFixed(2)});
    
    // Vignette
    createCRTLayer('crt-vignette','div',{opacity:(intensity/100*0.8).toFixed(2)});
    
    // Phosphor Glow
    createCRTLayer('crt-glow','div',{opacity:(intensity/100*0.6).toFixed(2)});
    
    // Curvature Mask
    if(curvature!=='0'){
      root.classList.add('crt-curved');
      createCRTLayer('crt-curvature-mask','div',{opacity:'1'});
    }
    
    // Flicker
    var flickerEnabled=root.style.getPropertyValue('--terminal-crt-flicker');
    if(flickerEnabled!=='0'){
      root.classList.add('crt-flickering');
    }
    
    // Chromatic Aberration
    var chromaEnabled=root.style.getPropertyValue('--terminal-crt-chromatic');
    if(chromaEnabled!=='0'){
      createCRTLayer('crt-chroma','div',{opacity:'0.6'});
    }
    
    // Noise
    createCRTLayer('crt-noise','div',{opacity:(intensity/100*0.25).toFixed(2)});
    
    // Glass Reflection
    createCRTLayer('crt-glass-reflection','div',{opacity:'0.5'});
    
    // Text Glow
    root.classList.add('crt-text-glow');
    
    // Phosphor Persistence
    root.classList.add('crt-phosphor-trail');
    
    // Distortion line
    createCRTLayer('crt-distortion','div',{opacity:'1'});
    
    // Overscan
    root.classList.add('crt-overscan');
    createCRTLayer('crt-overscan-border','div',{opacity:'1'});
  }
  
  function createCRTLayer(className,tag,style){
    if(document.querySelector('.'+className)) return;
    var el=document.createElement(tag||'div');
    el.className=className;
    if(style) Object.assign(el.style,style);
    document.body.appendChild(el);
  }
  
  function removeCRT(){
    var root=document.documentElement;
    root.classList.remove('crt-curved','crt-flickering','crt-text-glow','crt-phosphor-trail','crt-overscan','crt-booting','crt-subpixel');
    document.querySelectorAll('.crt-scanlines-fine,.crt-vignette,.crt-glow,.crt-curvature-mask,.crt-chroma,.crt-noise,.crt-glass-reflection,.crt-distortion,.crt-overscan-border').forEach(function(el){el.remove();});
  }

  initCRT();

  // ═══════════════════════════════════════════
  // DYNAMIC COMMAND LINE — Keyboard Interaction
  // ═══════════════════════════════════════════
  
  var cmdHistory=[];
  var cmdIndex=-1;
  var cmdMode=false;
  
  // Activate command mode with Ctrl+K or ` key
  document.addEventListener('keydown',function(e){
    if(e.key==='`'&&!cmdMode){
      e.preventDefault();
      cmdMode=true;
      showCmdPrompt();
      return;
    }
    if(e.key==='Escape'&&cmdMode){
      cmdMode=false;
      hideCmdPrompt();
      return;
    }
    if(!cmdMode) return;
    handleCmdKey(e);
  });
  
  function showCmdPrompt(){
    var bar=document.getElementById('terminal-cmd-bar');
    if(!bar){
      bar=document.createElement('div');
      bar.id='terminal-cmd-bar';
      bar.style.cssText='position:fixed;bottom:48px;left:0;right:0;height:28px;background:#0d0d0d;border-top:1px solid #50fa7b;display:flex;align-items:center;padding:0 8px;z-index:1000;font-family:"IBM Plex Mono",monospace;font-size:13px;';
      bar.innerHTML='<span style="color:#50fa7b;font-weight:700;margin-right:8px;">iora@home:~$</span><input id="terminal-cmd-input" style="flex:1;background:transparent;border:none;color:#f8f8f2;font-family:inherit;font-size:inherit;outline:none;caret-color:#50fa7b;" autofocus placeholder="type command...">';
      document.body.appendChild(bar);
      setTimeout(function(){
        var inp=document.getElementById('terminal-cmd-input');
        if(inp) inp.focus();
      },50);
    }
  }
  
  function hideCmdPrompt(){
    var bar=document.getElementById('terminal-cmd-bar');
    if(bar) bar.remove();
  }
  
  function handleCmdKey(e){
    var inp=document.getElementById('terminal-cmd-input');
    if(!inp) return;
    
    if(e.key==='Enter'){
      e.preventDefault();
      var cmd=inp.value.trim();
      if(cmd){
        cmdHistory.push(cmd);
        cmdIndex=cmdHistory.length;
        executeCommand(cmd);
        inp.value='';
      }
      return;
    }
    
    if(e.key==='ArrowUp'){
      e.preventDefault();
      if(cmdIndex>0){cmdIndex--;inp.value=cmdHistory[cmdIndex];}
      return;
    }
    
    if(e.key==='ArrowDown'){
      e.preventDefault();
      if(cmdIndex<cmdHistory.length-1){cmdIndex++;inp.value=cmdHistory[cmdIndex];}
      else{cmdIndex=cmdHistory.length;inp.value='';}
      return;
    }
  }
  
  function executeCommand(cmd){
    var toast=document.createElement('div');
    toast.style.cssText='position:fixed;top:60px;right:8px;background:#0d0d0d;border:1px solid #50fa7b;color:#f8f8f2;font-family:"IBM Plex Mono",monospace;font-size:12px;padding:8px 12px;z-index:1001;max-width:400px;';
    
    var parts=cmd.split(' ');
    var command=parts[0].toLowerCase();
    var response='';
    
    switch(command){
      case 'help':
        response='Available: help, status, lights, climate, theme, crt, clear, exit\nCRT: crt on|off|intensity 10-100|flicker|chroma|curvature';
        break;
      case 'status':
        response='[OK] System online | Entities: '+document.querySelectorAll('.glass-card').length+' | Theme: terminal-cli';
        break;
      case 'lights':
        var lights=document.querySelectorAll('[data-entity-id*="light"]');
        response='Lights: '+lights.length+' entities found. Use --on/--off to control.';
        break;
      case 'climate':
        response='Climate control active. Current target temperatures loaded.';
        break;
      case 'theme':
        var mode=parts[1]||'?';
        if(mode==='green') response='Switching to Green Screen mode... (reload to apply)';
        else if(mode==='amber') response='Switching to Amber CRT mode... (reload to apply)';
        else if(mode==='matrix') response='Entering Matrix mode... (reload to apply)';
        else response='Usage: theme [green|amber|matrix]';
        break;
      case 'clear':
        document.querySelectorAll('.terminal-toast').forEach(function(t){t.remove();});
        hideCmdPrompt();
        cmdMode=false;
        return;
      case 'exit':
        hideCmdPrompt();
        cmdMode=false;
        toast.textContent='logout\nConnection closed.';
        document.body.appendChild(toast);
        setTimeout(function(){toast.remove();},2000);
        return;
      case 'crt':
        var sub=parts[1]||'?';
        if(sub==='on'){document.documentElement.style.setProperty('--terminal-crt-effect','1');initCRT();response='CRT effect: ON';}
        else if(sub==='off'){document.documentElement.style.setProperty('--terminal-crt-effect','0');removeCRT();response='CRT effect: OFF';}
        else if(sub==='intensity'&&parts[2]){document.documentElement.style.setProperty('--terminal-crt-intensity',parts[2]);removeCRT();initCRT();response='CRT intensity: '+parts[2];}
        else if(sub==='flicker'){var v=document.documentElement.style.getPropertyValue('--terminal-crt-flicker');document.documentElement.style.setProperty('--terminal-crt-flicker',v==='0'?'1':'0');response='CRT flicker: '+(v==='0'?'ON':'OFF');}
        else if(sub==='chroma'){var v=document.documentElement.style.getPropertyValue('--terminal-crt-chromatic');document.documentElement.style.setProperty('--terminal-crt-chromatic',v==='0'?'1':'0');removeCRT();initCRT();response='CRT chromatic: '+(v==='0'?'ON':'OFF');}
        else if(sub==='curvature'){var v=document.documentElement.style.getPropertyValue('--terminal-crt-curvature');document.documentElement.style.setProperty('--terminal-crt-curvature',v==='0'?'1':'0');removeCRT();initCRT();response='CRT curvature: '+(v==='0'?'ON':'OFF');}
        else response='Usage: crt [on|off|intensity 10-100|flicker|chroma|curvature]';
        break;
      default:
        response='command not found: '+command+' (type "help" for available commands)';
    }
    
    toast.className='terminal-toast';
    toast.innerHTML='<span style="color:#50fa7b;font-weight:700;">$</span> '+cmd+'<br><span style="color:#6272a4;">'+response+'</span>';
    document.body.appendChild(toast);
    setTimeout(function(){toast.style.opacity='0';toast.style.transition='opacity 0.5s';setTimeout(function(){toast.remove();},500);},4000);
  }
})();
