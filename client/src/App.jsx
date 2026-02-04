import { useEffect, useState, useRef } from 'react';
import './App.css';
import io from 'socket.io-client';
import EmojiPicker from 'emoji-picker-react'; // 🔥 IMPORTANTE
import { Video, Send, Hash, Monitor, User, PhoneOff, Lock, AlertCircle, LogOut, Phone, X, Save, CheckCircle, Trash2, AlertTriangle, Crown, ShieldCheck, ShieldAlert, Bell, Paperclip, Smile, FileText, Download } from 'lucide-react';

const socket = io.connect("http://localhost:3001");
const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
const AVAILABLE_ROOMS = ["Geral", "Dúvidas", "Projetos"]; 

function App() {
  // DADOS USER
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isAdmin, setIsAdmin] = useState(false); 
  const [allowedRooms, setAllowedRooms] = useState([]); 

  // UI
  const [isRegistering, setIsRegistering] = useState(false);
  const [authError, setAuthError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false); 
  const [allUsers, setAllUsers] = useState([]); 

  // POPUPS
  const [accessRequestRoom, setAccessRequestRoom] = useState(null); 
  const [notification, setNotification] = useState({ show: false, message: "", type: "success" }); 

  // 🔥 NOVO: EMOJIS E FICHEIROS
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);

  // APP
  const [currentMessage, setCurrentMessage] = useState("");
  const [messageList, setMessageList] = useState([]);
  const [room, setRoom] = useState("Geral");
  const [inCall, setInCall] = useState(false);
  const [isRoomCreator, setIsRoomCreator] = useState(false);
  const [remoteStream, setRemoteStream] = useState(null);
  
  const myVideoRef = useRef();
  const remoteVideoRef = useRef();
  const peerConnectionRef = useRef(null);

  const showNotification = (msg, type = "success") => {
    setNotification({ show: true, message: msg, type });
    setTimeout(() => setNotification({ show: false, message: "", type: "success" }), 4000);
  };

  // --- LOGICA DE FICHEIROS ---
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Converter para Base64
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedFile({
          name: file.name,
          type: file.type,
          content: reader.result // Base64 string
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onEmojiClick = (emojiObject) => {
    setCurrentMessage(prev => prev + emojiObject.emoji);
    // Não fecha o picker para permitir escolher vários
  };

  // --- AUTH ---
  const handleAuth = () => {
    setAuthError(""); 
    if (isRegistering) {
      if (!username || !password || !firstName || !lastName) { setAuthError("Preenche os campos obrigatórios (*)"); return; }
      socket.emit('register_user', { username, password, firstName, lastName, phoneNumber });
    } else {
      if (!username || !password) { setAuthError("Preenche user e password."); return; }
      socket.emit('login_user', { username, password });
    }
  };

  const handleLogout = () => {
    if (inCall) { endCall(); socket.emit('end_call', room); }
    setIsLoggedIn(false); setShowProfile(false); setShowAdminPanel(false); setAccessRequestRoom(null);
    setUsername(""); setPassword(""); setFirstName(""); setLastName(""); setPhoneNumber("");
    setRoom("Geral"); setAuthError(""); setProfileSuccess(""); setIsAdmin(false); setAllowedRooms([]);
  };

  const handleDeleteAccount = () => { setShowDeleteConfirm(true); };
  const confirmDeleteAccount = () => { socket.emit('delete_account', username); };

  // --- ADMIN ---
  const changeRoom = (targetRoom) => {
    if (allowedRooms.includes(targetRoom)) { setRoom(targetRoom); } else { setAccessRequestRoom(targetRoom); }
  };
  const confirmRequestAccess = () => { if (accessRequestRoom) { socket.emit('request_access', { username, room: accessRequestRoom }); setAccessRequestRoom(null); showNotification(`Pedido enviado!`, "info"); } };
  const openAdminPanel = () => { socket.emit('get_all_users'); setShowAdminPanel(true); };
  const toggleUserPermission = (targetUser, targetRoom, action) => { socket.emit('toggle_permission', { targetUsername: targetUser, room: targetRoom, action }); };
  const initiateAdminDelete = (targetUser) => { if (window.confirm("Eliminar utilizador?")) socket.emit('admin_delete_user', targetUser); };

  // --- SOCKET LISTENERS ---
  useEffect(() => {
    socket.on('auth_success', (data) => {
      setUsername(data.username); setFirstName(data.firstName); setLastName(data.lastName);
      setPhoneNumber(data.phoneNumber); setIsAdmin(data.isAdmin); setAllowedRooms(data.allowedRooms || []);
      setIsLoggedIn(true); setAuthError("");
    });
    socket.on('auth_error', (msg) => setAuthError(msg));
    socket.on('phone_updated_success', (msg) => { setProfileSuccess(msg); setTimeout(() => setProfileSuccess(""), 3000); });
    socket.on('account_deleted_success', () => { handleLogout(); setAuthError("Conta eliminada com sucesso."); });
    socket.on('all_users_data', (users) => { setAllUsers(users); });
    socket.on('admin_action_success', (msg) => showNotification(msg, "success"));
    socket.on('force_logout_user', (targetUser) => { if (targetUser === username) { handleLogout(); setAuthError("A tua conta foi eliminada pelo Administrador."); } });
    socket.on('permissions_updated', (data) => { if (data.username === username) { setAllowedRooms(data.allowedRooms); showNotification("Permissões atualizadas!", "success"); } });
    
    socket.on("receive_message", (data) => setMessageList((l) => [...l, data]));
    socket.on('load_history', (h) => setMessageList(h));
    socket.on('call_ended', () => endCall());
    socket.on('offer', async (p) => { if (!peerConnectionRef.current) createPeerConnection(); await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(p.offer)); const a = await peerConnectionRef.current.createAnswer(); await peerConnectionRef.current.setLocalDescription(a); socket.emit('answer', { answer: a, room }); setInCall(true); });
    socket.on('answer', async (p) => { await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(p.answer)); });
    socket.on('ice-candidate', async (p) => { if(peerConnectionRef.current) await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(p.candidate)); });

    return () => { socket.removeAllListeners(); }
  }, [username, room]); 

  const handleUpdatePhone = () => { socket.emit('update_phone', { username, phoneNumber }); };
  
  // 🔥 SEND MESSAGE AGORA ENVIA FICHEIROS 🔥
  const sendMessage = async () => { 
    if (currentMessage !== "" || selectedFile) { 
      const m = { 
        room, 
        author: username, 
        message: currentMessage, 
        file: selectedFile, // Envia o ficheiro se existir
        time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) 
      }; 
      await socket.emit("send_message", m); 
      setMessageList((l) => [...l, m]); 
      setCurrentMessage(""); 
      clearFile(); // Limpa o ficheiro depois de enviar
      setShowEmojiPicker(false);
    } 
  };

  const createPeerConnection = () => { const pc = new RTCPeerConnection(rtcConfig); pc.onicecandidate = (e) => { if (e.candidate) socket.emit('ice-candidate', { candidate: e.candidate, room }); }; pc.ontrack = (e) => setRemoteStream(e.streams[0]); if (myVideoRef.current && myVideoRef.current.srcObject) { myVideoRef.current.srcObject.getTracks().forEach(t => pc.addTrack(t, myVideoRef.current.srcObject)); } peerConnectionRef.current = pc; return pc; };
  const startCall = async () => { setInCall(true); setIsRoomCreator(true); const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); if (myVideoRef.current) myVideoRef.current.srcObject = s; setTimeout(async () => { const pc = createPeerConnection(); const o = await pc.createOffer(); await pc.setLocalDescription(o); socket.emit('offer', { offer: o, room }); }, 100); };
  const joinCall = async () => { const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); if (myVideoRef.current) myVideoRef.current.srcObject = s; s.getTracks().forEach(t => { if (peerConnectionRef.current) peerConnectionRef.current.addTrack(t, s); }); const pc = peerConnectionRef.current; const o = await pc.createOffer(); await pc.setLocalDescription(o); socket.emit('offer', { offer: o, room }); };
  const endCall = () => { if (myVideoRef.current?.srcObject) { myVideoRef.current.srcObject.getTracks().forEach(t => t.stop()); myVideoRef.current.srcObject = null; } if (peerConnectionRef.current) { peerConnectionRef.current.close(); peerConnectionRef.current = null; } setInCall(false); setRemoteStream(null); setIsRoomCreator(false); };
  const hangUp = () => { endCall(); socket.emit('end_call', room); };
  useEffect(() => { if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream; }, [remoteStream, inCall]);
  useEffect(() => { if (isLoggedIn) socket.emit("join_room", room); }, [room, isLoggedIn]);

  const usersListFiltered = allUsers.filter(u => u.username !== 'admin');

  if (!isLoggedIn) {
    return (
      <div className="login-container">
        <div className="login-card">
          <h2><Monitor size={32} /> CoLab Teams</h2>
          <h3>{isRegistering ? 'Criar Nova Conta' : 'Iniciar Sessão'}</h3>
          {authError && <div style={{background:'#FEE2E2', color:'#DC2626', padding:'8px', borderRadius:'8px', marginBottom:'15px', fontSize:'13px', display:'flex', alignItems:'center', gap:'8px', textAlign:'left'}}><AlertCircle size={16} style={{minWidth:'16px'}} /> {authError}</div>}
          {isRegistering && (<><div style={{display:'flex', gap:'10px', marginBottom:'12px'}}><div style={{flex:1, textAlign:'left'}}><label style={{fontSize:'11px', fontWeight:'bold', color:'#6B7280', display:'block', marginBottom:'4px'}}>NOME *</label><input type="text" className="login-input" placeholder="Maria" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div><div style={{flex:1, textAlign:'left'}}><label style={{fontSize:'11px', fontWeight:'bold', color:'#6B7280', display:'block', marginBottom:'4px'}}>APELIDO *</label><input type="text" className="login-input" placeholder="Silva" value={lastName} onChange={(e) => setLastName(e.target.value)} /></div></div><div style={{textAlign:'left', marginBottom:'12px'}}><label style={{fontSize:'11px', fontWeight:'bold', color:'#6B7280', display:'block', marginBottom:'4px'}}>TELEMÓVEL (Opcional)</label><div style={{position:'relative'}}><Phone size={16} style={{position:'absolute', top:'13px', left:'12px', color:'#9CA3AF'}} /><input type="text" className="login-input" style={{paddingLeft:'38px'}} placeholder="912 345 678" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} /></div></div></>)}
          <div style={{textAlign:'left', marginBottom:'12px'}}><label style={{fontSize:'11px', fontWeight:'bold', color:'#6B7280', display:'block', marginBottom:'4px'}}>UTILIZADOR *</label><div style={{position:'relative'}}><User size={16} style={{position:'absolute', top:'13px', left:'12px', color:'#9CA3AF'}} /><input type="text" className="login-input" style={{paddingLeft:'38px'}} placeholder="Ex: mariasilva88" value={username} onChange={(e) => setUsername(e.target.value)} /></div></div>
          <div style={{textAlign:'left', marginBottom:'20px'}}><label style={{fontSize:'11px', fontWeight:'bold', color:'#6B7280', display:'block', marginBottom:'4px'}}>PASSWORD *</label><div style={{position:'relative'}}><Lock size={16} style={{position:'absolute', top:'13px', left:'12px', color:'#9CA3AF'}} /><input type="password" className="login-input" style={{paddingLeft:'38px'}} placeholder="********" value={password} onChange={(e) => setPassword(e.target.value)} onKeyPress={(e) => e.key === "Enter" && handleAuth()} /></div></div>
          <button onClick={handleAuth} className="btn-login">{isRegistering ? 'Criar Conta' : 'Entrar'}</button>
          <div style={{marginTop:'15px', fontSize:'13px', color:'#6B7280'}}>{isRegistering ? 'Já tens conta?' : 'Ainda não tens conta?'}<span onClick={() => { setIsRegistering(!isRegistering); setAuthError(""); }} style={{color:'#2563EB', fontWeight:'bold', cursor:'pointer', marginLeft:'5px'}}>{isRegistering ? 'Faz Login' : 'Regista-te aqui'}</span></div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {notification.show && (<div style={{position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', background: notification.type === 'success' ? '#065F46' : '#1E40AF', color: 'white', padding: '12px 24px', borderRadius: '50px', zIndex: 3000, display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', animation: 'fadeIn 0.3s ease'}}>{notification.type === 'success' ? <CheckCircle size={18} /> : <Bell size={18} />}<span style={{fontWeight:'600', fontSize:'14px'}}>{notification.message}</span></div>)}
      {accessRequestRoom && (<div style={{position:'fixed', top:0, left:0, width:'100vw', height:'100vh', background:'rgba(0,0,0,0.6)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center'}}><div style={{background:'white', padding:'30px', borderRadius:'16px', width:'350px', textAlign:'center', animation:'fadeIn 0.3s ease'}}><div style={{background:'#DBEAFE', width:'60px', height:'60px', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 20px auto'}}><Lock size={30} color="#2563EB" /></div><h2 style={{color:'#111827', marginBottom:'10px', fontSize:'20px'}}>Acesso Bloqueado</h2><p style={{color:'#6B7280', marginBottom:'25px'}}>Não tens acesso à sala <strong>#{accessRequestRoom}</strong>. Queres enviar um pedido de autorização ao Admin?</p><div style={{display:'flex', gap:'10px'}}><button onClick={() => setAccessRequestRoom(null)} style={{flex:1, padding:'10px', borderRadius:'8px', border:'1px solid #E5E7EB', background:'white', cursor:'pointer', fontWeight:'600', color:'#374151'}}>Cancelar</button><button onClick={confirmRequestAccess} style={{flex:1, padding:'10px', borderRadius:'8px', border:'none', background:'#2563EB', color:'white', cursor:'pointer', fontWeight:'600'}}>Pedir Acesso</button></div></div></div>)}
      {showAdminPanel && (<div style={{position:'fixed', top:0, left:0, width:'100vw', height:'100vh', background:'rgba(0,0,0,0.5)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center'}}><div style={{background:'white', padding:'30px', borderRadius:'16px', width:'700px', maxHeight:'80vh', overflowY:'auto', position:'relative', boxShadow:'0 20px 50px rgba(0,0,0,0.2)'}}><button onClick={() => setShowAdminPanel(false)} style={{position:'absolute', top:'15px', right:'15px', background:'none', border:'none', cursor:'pointer'}}><X size={24} color="#6B7280" /></button><h2 style={{color:'#D97706', display:'flex', alignItems:'center', gap:'10px', marginBottom:'20px'}}><Crown size={28} /> Painel de Administrador</h2><p style={{marginBottom:'20px', color:'#6B7280'}}>Total de Utilizadores: {usersListFiltered.length}</p><div style={{display:'flex', flexDirection:'column', gap:'10px'}}>{usersListFiltered.map((u, idx) => (<div key={idx} style={{padding:'15px', border:'1px solid #E5E7EB', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'space-between'}}><div><p style={{fontWeight:'bold'}}>{u.firstName} {u.lastName} <span style={{color:'#9CA3AF', fontSize:'12px'}}>@{u.username}</span></p>{u.pendingRequests && u.pendingRequests.length > 0 && (<div style={{marginTop:'5px', color:'#DC2626', fontSize:'12px', display:'flex', alignItems:'center', gap:'5px'}}><ShieldAlert size={14}/> Pediu acesso a: {u.pendingRequests.join(", ")}</div>)}</div><div style={{display:'flex', alignItems:'center', gap:'15px'}}><div style={{display:'flex', gap:'5px'}}>{AVAILABLE_ROOMS.map(r => (<button key={r} onClick={() => toggleUserPermission(u.username, r, u.allowedRooms.includes(r) ? 'revoke' : 'grant')} style={{padding:'5px 10px', borderRadius:'5px', fontSize:'12px', cursor:'pointer', border: '1px solid', borderColor: u.allowedRooms.includes(r) ? '#10B981' : '#E5E7EB', background: u.allowedRooms.includes(r) ? '#D1FAE5' : 'white', color: u.allowedRooms.includes(r) ? '#065F46' : '#9CA3AF'}}>{r} {u.allowedRooms.includes(r) ? '✅' : '🔒'}</button>))}</div><button onClick={() => initiateAdminDelete(u.username)} title="Eliminar Utilizador" style={{border:'none', background:'none', cursor:'pointer', color:'#EF4444'}}><Trash2 size={20} /></button></div></div>))}</div></div></div>)}
      {showProfile && !showAdminPanel && (<div style={{position:'fixed', top:0, left:0, width:'100vw', height:'100vh', background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center'}}><div style={{background:'white', padding:'30px', borderRadius:'16px', width:'400px', position:'relative', boxShadow:'0 20px 50px rgba(0,0,0,0.2)', textAlign:'center'}}><button onClick={() => {setShowProfile(false); setShowDeleteConfirm(false);}} style={{position:'absolute', top:'15px', right:'15px', background:'none', border:'none', cursor:'pointer'}}><X size={24} color="#6B7280" /></button>{!showDeleteConfirm ? (<><h2 style={{color:'#2563EB', display:'flex', alignItems:'center', justifyContent:'center', gap:'10px', marginBottom:'20px'}}><User size={28} /> O Meu Perfil</h2>{profileSuccess && <div style={{background:'#D1FAE5', color:'#065F46', padding:'10px', borderRadius:'8px', marginBottom:'20px', fontSize:'14px', display:'flex', alignItems:'center', justifyContent:'center', gap:'8px', fontWeight: '600'}}><CheckCircle size={16} /> {profileSuccess}</div>}{isAdmin && <div style={{background:'#FEF3C7', color:'#B45309', padding:'10px', borderRadius:'8px', marginBottom:'20px', fontSize:'12px', fontWeight:'bold'}}>👑 TU ÉS ADMINISTRADOR</div>}<div style={{textAlign:'left', marginBottom:'10px'}}><p style={{fontSize:'12px', fontWeight:'bold', color:'#6B7280'}}>NOME COMPLETO</p><p style={{fontSize:'16px', fontWeight:'600'}}>{firstName} {lastName}</p></div><div style={{textAlign:'left', marginBottom:'20px'}}><p style={{fontSize:'12px', fontWeight:'bold', color:'#6B7280'}}>UTILIZADOR</p><p style={{fontSize:'16px', fontWeight:'600'}}>@{username}</p></div><div style={{textAlign:'left', marginBottom:'25px'}}><label style={{fontSize:'12px', fontWeight:'bold', color:'#6B7280', display:'block', marginBottom:'5px'}}>TELEMÓVEL</label><input type="text" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className="login-input" placeholder="Sem número" /></div><button onClick={handleUpdatePhone} className="btn-login" style={{display:'flex', alignItems:'center', justifyContent:'center', gap:'10px', marginBottom:'20px'}}><Save size={18} /> Guardar</button>{!isAdmin && (<div style={{borderTop:'1px solid #E5E7EB', paddingTop:'20px'}}><button onClick={handleDeleteAccount} style={{width:'100%', padding:'12px', borderRadius:'8px', border:'1px solid #EF4444', background:'white', color:'#EF4444', fontWeight:'bold', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:'8px'}}><Trash2 size={18} /> Eliminar Conta</button></div>)}</>) : (<div style={{animation: 'fadeIn 0.3s ease'}}><div style={{background:'#FEE2E2', width:'60px', height:'60px', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 20px auto'}}><AlertTriangle size={30} color="#DC2626" /></div><h2 style={{color:'#DC2626', marginBottom:'10px'}}>Tens a certeza?</h2><p style={{color:'#6B7280', marginBottom:'30px'}}>Ação irreversível.</p><div style={{display:'flex', gap:'10px'}}><button onClick={() => setShowDeleteConfirm(false)} style={{flex:1, padding:'12px', borderRadius:'8px', border:'1px solid #E5E7EB', background:'white'}}>Cancelar</button><button onClick={confirmDeleteAccount} style={{flex:1, padding:'12px', borderRadius:'8px', background:'#DC2626', color:'white', border:'none'}}>Sim, Eliminar</button></div></div>)}</div></div>)}
      <div className="sidebar">
        <h2><Monitor size={24} color="#2563EB" /> CoLab.</h2>
        {AVAILABLE_ROOMS.map((r) => { const canAccess = allowedRooms.includes(r); return (<div key={r} className={room === r ? "channel active" : "channel"} onClick={() => changeRoom(r)} style={{ opacity: canAccess ? 1 : 0.5, cursor: canAccess ? 'pointer' : 'not-allowed', display:'flex', justifyContent:'space-between' }}><div style={{display:'flex', alignItems:'center', gap:'8px'}}><Hash size={18} /> {r}</div>{!canAccess && <Lock size={14} />}</div>)})}
        <div style={{marginTop: 'auto', paddingTop: '20px', borderTop: '1px solid #E5E7EB', display:'flex', alignItems:'center', justifyContent: 'space-between'}}>
           <div onClick={() => setShowProfile(true)} style={{display:'flex', alignItems:'center', gap:'10px', cursor:'pointer'}}><div style={{width:'35px', height:'35px', background: isAdmin ? '#D97706' : '#2563EB', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:'bold'}}>{isAdmin ? <Crown size={18}/> : username.charAt(0).toUpperCase()}</div><div><p style={{fontSize:'14px', fontWeight:'bold', color:'#374151'}}>{username}</p><p style={{fontSize:'12px', color: isAdmin ? '#D97706' : '#10B981'}}>{isAdmin ? 'Admin' : 'Online'}</p></div></div>
           {isAdmin && (<button onClick={openAdminPanel} title="Painel Admin" style={{background:'#FEF3C7', border:'none', cursor:'pointer', color:'#D97706', padding:'5px', borderRadius:'5px'}}><ShieldCheck size={20} /></button>)}
           <button onClick={handleLogout} title="Sair" style={{background:'transparent', border:'none', cursor:'pointer', color:'#6B7280', padding:'5px', borderRadius:'5px'}}><LogOut size={20} /></button>
        </div>
      </div>

      <div className="chat-window">
        <div className="chat-header">
          <div className="header-title"><Hash size={20} color="#2563EB" /> {room}</div>
          {!inCall ? (<button onClick={startCall} className="btn-primary"><Video size={18} /> Iniciar Vídeo</button>) : (<div style={{display: 'flex', gap: '10px'}}>{!isRoomCreator && <button onClick={joinCall} className="btn-success"><Video size={18} /> Ligar Câmara</button>}<button onClick={hangUp} style={{backgroundColor: '#EF4444', color:'white', padding:'8px 15px', borderRadius:'8px', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:'8px', fontWeight:'600'}}><PhoneOff size={18} /> Sair</button></div>)}
        </div>
        {inCall && (<div className="video-grid"><div className="video-card"><video ref={myVideoRef} autoPlay playsInline muted /><div className="user-label"> <User size={12} /> {username} (Eu)</div></div><div className="video-card" style={{ border: remoteStream ? '2px solid #10B981' : '2px dashed #444' }}><video ref={remoteVideoRef} autoPlay playsInline muted />{!remoteStream && <p style={{color:'#666', position:'absolute', top:'50%', left:'30%'}}>À espera...</p>}<div className="user-label">Colega</div></div></div>)}
        <div className="chat-body">
          {messageList.filter((msg) => msg.room === room).map((msg, index) => (
            <div className="message-container" id={username === msg.author ? "you" : "other"} key={index}>
              <div className="message-content">
                <span style={{fontSize:'10px', color: username === msg.author ? '#BFDBFE' : '#6B7280', marginBottom:'2px', display:'block', fontWeight:'bold'}}>{msg.author}</span>
                {/* MOSTRAR FICHEIRO SE EXISTIR */}
                {msg.file && (
                   <div className="msg-file-attachment">
                      {msg.file.type.startsWith('image/') ? (
                         <img src={msg.file.content} alt={msg.file.name} onClick={() => { const w = window.open(""); w.document.write(`<img src="${msg.file.content}" />`); }} />
                      ) : (
                         <a href={msg.file.content} download={msg.file.name} className="msg-file-download"><FileText size={16} /> {msg.file.name} <Download size={14}/></a>
                      )}
                   </div>
                )}
                {msg.message && <p>{msg.message}</p>}
              </div>
              <div className="message-meta"><span>{msg.time}</span></div>
            </div>
          ))}
        </div>
        
        <div className="chat-footer">
          {/* PRÉ VISUALIZAÇÃO DO FICHEIRO SELECIONADO */}
          {selectedFile && (
             <div className="file-preview">
                {selectedFile.type.startsWith('image/') ? <img src={selectedFile.content} /> : <FileText size={24} color="#6B7280" />}
                <span>{selectedFile.name}</span>
                <button onClick={clearFile} style={{border:'none', background:'transparent', cursor:'pointer'}}><X size={16} color="#EF4444" /></button>
             </div>
          )}

          {/* PICKER DE EMOJIS */}
          {showEmojiPicker && (
            <div className="emoji-picker-container">
               <EmojiPicker onEmojiClick={onEmojiClick} height={400} width={300} searchDisabled />
            </div>
          )}

          {/* INPUT COM ÍCONES DENTRO */}
          <div className="input-wrapper">
            <input type="text" value={currentMessage} placeholder={`Escreve em #${room}...`} onChange={(e) => setCurrentMessage(e.target.value)} onKeyPress={(e) => e.key === "Enter" && sendMessage()} />
            
            <div className="chat-actions">
               {/* INPUT DE FICHEIRO INVISÍVEL */}
               <input type="file" ref={fileInputRef} onChange={handleFileSelect} style={{display:'none'}} />
               
               <button className="action-btn" onClick={() => setShowEmojiPicker(!showEmojiPicker)}><Smile size={20} /></button>
               <button className="action-btn" onClick={() => fileInputRef.current.click()}><Paperclip size={20} /></button>
            </div>
          </div>
          
          <button onClick={sendMessage} className="btn-icon"><Send size={20} /></button>
        </div>
      </div>
    </div>
  );
}

export default App;