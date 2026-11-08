(function(global){
  'use strict';

  function install(){
    if(!global.WExportPopup||!global.React||!global.KittensLiveSyncPhone){setTimeout(install,80);return;}
    if(global.WExportPopup.__liveSyncInstalled)return;
    global.WExportPopup.__liveSyncInstalled=true;

    var proto=WExportPopup.prototype;
    var originalInitial=proto.getInitialState;
    var originalDidMount=proto.componentDidMount;
    var originalWillUnmount=proto.componentWillUnmount;
    var originalRender=proto.render;

    proto.getInitialState=function(){
      var s=originalInitial?originalInitial.call(this):{};
      s.liveEndpoint=(global.KittensLiveSyncPhone&&KittensLiveSyncPhone.getEndpoint())||'';
      s.liveStatus='';
      s.liveBusy=false;
      s.livePairCode='';
      return s;
    };

    proto.componentDidMount=function(){
      if(originalDidMount)originalDidMount.call(this);
      var self=this;
      this._liveSyncListener=function(e){
        var st=e&&e.detail?e.detail:(global.KittensLiveSyncPhone?KittensLiveSyncPhone.getStatus():{});
        if(self.isMounted&&self.isMounted()){
          self.setState({
            liveStatus:st.message||'',
            livePairCode:st.pairCode||self.state.livePairCode||''
          });
        }
      };
      window.addEventListener('kittens-live-sync-phone-status',this._liveSyncListener);
      setTimeout(function(){
        try{
          KittensLiveSyncPhone.init();
          var st=KittensLiveSyncPhone.getStatus();
          if(self.isMounted&&self.isMounted())self.setState({
            liveEndpoint:KittensLiveSyncPhone.getEndpoint()||self.state.liveEndpoint,
            liveStatus:st.message||'',
            livePairCode:st.pairCode||''
          });
        }catch(e){}
      },0);
    };

    proto.componentWillUnmount=function(){
      if(this._liveSyncListener)window.removeEventListener('kittens-live-sync-phone-status',this._liveSyncListener);
      if(originalWillUnmount)originalWillUnmount.call(this);
    };

    proto._liveEndpointChange=function(e){this.setState({liveEndpoint:e.target.value});};

    proto._liveInitialize=function(e){
      if(e&&e.preventDefault)e.preventDefault();
      if(this.state.liveBusy)return;
      var self=this;
      this.setState({liveBusy:true,liveStatus:'Initializing Live Sync…'});
      KittensLiveSyncPhone.initialize(this.state.liveEndpoint).then(function(){
        self.setState({liveBusy:false,liveStatus:'Live Sync initialized. This phone owns the session.'});
      }).catch(function(err){
        self.setState({liveBusy:false,liveStatus:'Live Sync setup failed: '+err.message});
      });
    };

    proto._livePair=function(e){
      if(e&&e.preventDefault)e.preventDefault();
      if(this.state.liveBusy)return;
      var self=this;
      this.setState({liveBusy:true,liveStatus:'Creating watch pairing code…'});
      KittensLiveSyncPhone.createWatchPairCode().then(function(r){
        self.setState({liveBusy:false,livePairCode:r.code,liveStatus:'Enter '+r.code+' on the watch. Code expires in 10 minutes.'});
      }).catch(function(err){
        self.setState({liveBusy:false,liveStatus:'Could not create watch code: '+err.message});
      });
    };

    proto._liveTakeControl=function(e){
      if(e&&e.preventDefault)e.preventDefault();
      KittensLiveSyncPhone.takeControl();
      this.setState({liveStatus:'Requesting control on this phone…'});
    };

    proto._liveDisable=function(e){
      if(e&&e.preventDefault)e.preventDefault();
      if(!window.confirm('Disable Live Sync on this phone? GitHub Plan A will remain available as the fallback.'))return;
      KittensLiveSyncPhone.disable();
      this.setState({liveStatus:'Live Sync disabled.',livePairCode:''});
    };

    proto.render=function(){
      var root=originalRender.call(this);
      try{
        var children=React.Children.toArray(root.props.children);
        var content=children[1];
        if(!content||!content.props)return root;
        var cc=React.Children.toArray(content.props.children);
        var st=KittensLiveSyncPhone.getStatus();
        var configured=!!st.configured;
        var role=st.role||'offline';
        var live=[
          $r('br',{key:'live-br'}),
          $r('h1',{key:'live-title'},'Live Sync'),
          $r('span',{key:'live-desc'},'Real-time single-session sync. Only one device writes at a time; switching devices automatically hands over the latest save.'),
          $r('input',{
            key:'live-endpoint',type:'url',
            style:{width:'100%',boxSizing:'border-box',marginTop:'10px'},
            placeholder:'https://kittens-live-sync.<account>.workers.dev',
            value:this.state.liveEndpoint,onChange:this._liveEndpointChange.bind(this),
            autoCorrect:'off',autoCapitalize:'off',spellCheck:'false'
          }),
          $r('p',{key:'live-init'},[$r('a',{href:'#',className:'button',onClick:this._liveInitialize.bind(this)},configured?'Reconnect / verify Live Sync':'Initialize Live Sync from this phone')]),
          configured?$r('p',{key:'live-pair'},[$r('a',{href:'#',className:'button',onClick:this._livePair.bind(this)},'Generate watch pairing code')]):null,
          this.state.livePairCode?$r('div',{key:'live-code',style:{fontSize:'28px',fontWeight:'bold',letterSpacing:'6px',padding:'12px 0'}},this.state.livePairCode):null,
          configured?$r('p',{key:'live-control'},[$r('a',{href:'#',className:'button',onClick:this._liveTakeControl.bind(this)},'Take control on this phone')]):null,
          $r('p',{key:'live-state',style:{whiteSpace:'pre-wrap'}},this.state.liveStatus||('Status: '+role)),
          configured?$r('p',{key:'live-disable'},[$r('a',{href:'#',onClick:this._liveDisable.bind(this)},'Disable Live Sync and use GitHub fallback')]):null
        ].filter(Boolean);
        cc=cc.concat(live);
        var newContent=React.cloneElement(content,content.props,cc);
        children[1]=newContent;
        return React.cloneElement(root,root.props,children);
      }catch(e){
        console.warn('Live Sync phone UI injection failed',e);
        return root;
      }
    };
  }

  install();
})(window);
