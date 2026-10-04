(function(global){
  'use strict';
  function install(){
   if(!global.WExportPopup||!global.React){setTimeout(install,50);return;}
   if(global.WExportPopup.__planAInstalled)return;
   global.WExportPopup.__planAInstalled=true;

  var proto=WExportPopup.prototype;
  var originalInitial=proto.getInitialState;
  var originalDidMount=proto.componentDidMount;
  var originalWillUnmount=proto.componentWillUnmount;
  var originalRender=proto.render;

  proto.getInitialState=function(){
    var s=originalInitial?originalInitial.call(this):{};
    s.planAToken='';
    s.planAStatus='';
    s.planABusy=false;
    return s;
  };

  proto.componentDidMount=function(){
    if(originalDidMount)originalDidMount.call(this);
    var self=this;
    this._planAListener=function(e){
      var st=e&&e.detail?e.detail:(global.KittensPlanAPhone?KittensPlanAPhone.getStatus():{});
      if(self.isMounted&&self.isMounted())self.setState({planAStatus:st.message||'',planABusy:!!st.busy});
    };
    window.addEventListener('kittens-plan-a-status',this._planAListener);
    setTimeout(function(){
      try{
        if(global.KittensPlanAPhone&&KittensPlanAPhone.init()){
          var st=KittensPlanAPhone.getStatus();
          if(self.isMounted&&self.isMounted())self.setState({planAStatus:st.message||'',planABusy:!!st.busy});
        }
      }catch(e){
        if(self.isMounted&&self.isMounted())self.setState({planAStatus:'Plan A startup failed: '+e.message});
      }
    },0);
  };

  proto.componentWillUnmount=function(){
    if(this._planAListener)window.removeEventListener('kittens-plan-a-status',this._planAListener);
    if(originalWillUnmount)originalWillUnmount.call(this);
  };

  proto._planATokenChange=function(e){this.setState({planAToken:e.target.value});};

  proto._planASaveToken=function(e){
    if(e&&e.preventDefault)e.preventDefault();
    var self=this;
    try{
      if(!global.KittensPlanAPhone)throw new Error('Plan A runtime is not loaded.');
      if(this.state.planAToken)KittensPlanAPhone.setToken(this.state.planAToken);
      this.setState({planABusy:true,planAStatus:'Verifying private GitHub repository…'});
      KittensPlanAPhone.verify().then(function(){
        self.setState({planABusy:false,planAToken:'',planAStatus:KittensPlanAPhone.getStatus().message});
      }).catch(function(err){self.setState({planABusy:false,planAStatus:'GitHub verification failed: '+err.message});});
    }catch(err){this.setState({planABusy:false,planAStatus:err.message});}
  };

  proto._planAInitialize=function(e){
    if(e&&e.preventDefault)e.preventDefault();
    if(this.state.planABusy)return;
    if(!window.confirm('Use this phone village as the initial common Plan A baseline? This does not overwrite the watch yet.'))return;
    var self=this;
    this.setState({planABusy:true,planAStatus:'Creating canonical baseline from this phone…'});
    KittensPlanAPhone.bootstrap().then(function(r){
      self.setState({planABusy:false,planAStatus:r.created?'Canonical baseline created from this phone.':'Canonical baseline already exists.'});
    }).catch(function(err){self.setState({planABusy:false,planAStatus:'Initialization failed: '+err.message});});
  };

  proto._planAAdopt=function(e){
    if(e&&e.preventDefault)e.preventDefault();
    if(this.state.planABusy)return;
    if(!window.confirm('Replace this phone village with the existing canonical Plan A save? A local backup is created first.'))return;
    var self=this;
    this.setState({planABusy:true,planAStatus:'Adopting existing canonical revision…'});
    KittensPlanAPhone.adoptCanonical().then(function(r){
      self.setState({planABusy:false,planAStatus:r.ok?'Canonical revision adopted on this phone.':'Adoption needs attention: '+r.type});
    }).catch(function(err){self.setState({planABusy:false,planAStatus:'Adoption failed: '+err.message});});
  };

  proto._planAProvisionWatch=function(e){
    if(e&&e.preventDefault)e.preventDefault();
    if(this.state.planABusy)return;
    var self=this;
    this.setState({planABusy:true,planAStatus:'Encrypting GitHub configuration for the watch…'});
    KittensPlanAPhone.provisionWatch(this.state.syncUrl).then(function(){
      self.setState({planABusy:false,planAStatus:'Watch provisioned. Its GitHub token is protected by Android Keystore.'});
    }).catch(function(err){self.setState({planABusy:false,planAStatus:'Watch provisioning failed: '+err.message});});
  };

  proto._planASyncNow=function(e){
    if(e&&e.preventDefault)e.preventDefault();
    if(this.state.planABusy)return;
    var self=this;
    this.setState({planABusy:true,planAStatus:'Syncing Plan A…'});
    KittensPlanAPhone.syncNow().then(function(r){
      var msg;
      if(r&&r.type==='merge-conflict')msg='Merge conflict found. No local save was replaced.';
      else msg=KittensPlanAPhone.getStatus().message||'Plan A sync complete.';
      self.setState({planABusy:false,planAStatus:msg});
    }).catch(function(err){self.setState({planABusy:false,planAStatus:'Sync failed: '+err.message});});
  };

  proto.render=function(){
    var root=originalRender.call(this);
    try{
      var children=React.Children.toArray(root.props.children);
      var content=children[1];
      if(!content||!content.props)return root;
      var cc=React.Children.toArray(content.props.children);
      var configured=global.KittensPlanAPhone&&!!KittensPlanAPhone.getToken();
      var cloudState=global.KittensPlanAPhone?KittensPlanAPhone.getStatus():{};
      var planA=[
        $r('br',{key:'pa-br'}),
        $r('h1',{key:'pa-title'},'Plan A + GitHub'),
        $r('span',{key:'pa-desc'},'Private mailbox: kd40000-dot/KittensGame-Sync. Actions on phone and watch are journaled separately and merged from their last common revision.'),
        $r('input',{
          key:'pa-token',type:'password',
          style:{width:'100%',boxSizing:'border-box',marginTop:'10px'},
          placeholder:configured?'Fine-grained token configured — enter a new token only to replace it':'Fine-grained GitHub token',
          value:this.state.planAToken,onChange:this._planATokenChange.bind(this),
          autoComplete:'off',autoCorrect:'off',autoCapitalize:'off',spellCheck:'false'
        }),
        $r('p',{key:'pa-verify'},[$r('a',{href:'#',className:'button',onClick:this._planASaveToken.bind(this)},configured?'Verify GitHub access':'Save token & verify')]),
        $r('p',{key:'pa-init'},[$r('a',{href:'#',className:'button',onClick:this._planAInitialize.bind(this)},'Initialize canonical from this phone')]),
        $r('p',{key:'pa-adopt'},[$r('a',{href:'#',className:'button',onClick:this._planAAdopt.bind(this)},'Adopt existing canonical on phone')]),
        $r('p',{key:'pa-provision'},[$r('a',{href:'#',className:'button',onClick:this._planAProvisionWatch.bind(this)},'Provision current watch securely')]),
        $r('p',{key:'pa-sync'},[$r('a',{href:'#',className:'button',onClick:this._planASyncNow.bind(this)},'Sync GitHub now')]),
        $r('p',{key:'pa-state',style:{whiteSpace:'pre-wrap'}},this.state.planAStatus||cloudState.message||'Plan A not configured.')
      ];
      cc=cc.concat(planA);
      var newContent=React.cloneElement(content,content.props,cc);
      children[1]=newContent;
      return React.cloneElement(root,root.props,children);
    }catch(e){
      console.warn('Plan A export UI injection failed',e);
      return root;
    }
  };
  }
  install();
})(window);
