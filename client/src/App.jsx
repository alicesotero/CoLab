import { useEffect, useState, useRef } from 'react';
import './App.css';
import io from 'socket.io-client';
import { Video, Send, Hash, Monitor, User, PhoneOff } from 'lucide-react';

const socket = io.connect("http://localhost:3001");

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function App() {
  const [currentMessage, setCurrentMessage] = useState("");
  const [messageList, setMessageList] = useState([]);
  const [username] = useState("User-" + Math.floor(Math.random() * 100));
  const [room, setRoom] = useState("Geral");
  const [inCall, setInCall] = useState(false);
  const [isRoomCreator, setIsRoomCreator] = useState(false);
  const [remoteStream, setRemoteStream] = useState(null);
  
  const myVideoRef = useRef();
  const remoteVideoRef = useRef();
  const peerConnectionRef = useRef(null);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, inCall]);

  useEffect(() => {
    // Quando entramos na sala, o servidor vai enviar o histórico
    socket.emit("join_room", room);
  }, [room]);

  const sendMessage = async () => {
    if (currentMessage !== "") {
      const messageData = {
        room: room,
        author: username,
        message: currentMessage,
        time: new Date(Date.now()).getHours() + ":" + new Date(Date.now()).getMinutes().toString().padStart(2, '0'),
      };
      
      // Enviar para o servidor (que vai guardar na BD)
      await socket.emit("send_message", messageData);
      
      // Adicionar à nossa lista localmente para ver logo
      setMessageList((list) => [...list, messageData]);
      setCurrentMessage("");
    }
  };

  // --- LÓGICA DE ENCERRAR CHAMADA ---
  const endCall = () => {
    if (myVideoRef.current && myVideoRef.current.srcObject) {
      myVideoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      myVideoRef.current.srcObject = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    setInCall(false);
    setRemoteStream(null);
    setIsRoomCreator(false);
  };

  const hangUp = () => {
    endCall(); 
    socket.emit('end_call', room);
  };

  // --- OUVINTES DO SOCKET (AQUI ESTÁ A CORREÇÃO) ---
  useEffect(() => {
    // 1. Receber Mensagem Nova em Tempo Real
    socket.on("receive_message", (data) => {
      setMessageList((list) => [...list, data]);
    });
    
    // 2. 🔥 RECEBER HISTÓRICO DA BASE DE DADOS 🔥
    // Isto substitui a lista vazia pelas mensagens antigas que vieram do MongoDB
    socket.on('load_history', (history) => {
      console.log("Histórico recebido:", history); // Para vermos na consola se funcionou
      setMessageList(history);
    });

    socket.on('call_ended', () => { endCall(); });

    // WebRTC
    socket.on('offer', async (payload) => {
      if (!peerConnectionRef.current) createPeerConnection();
      const pc = peerConnectionRef.current;
      await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { answer, room });
      setInCall(true);
    });

    socket.on('answer', async (payload) => {
      const pc = peerConnectionRef.current;
      await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
    });

    socket.on('ice-candidate', async (payload) => {
      const pc = peerConnectionRef.current;
      if (pc) await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    });

    // Limpeza ao desmontar
    return () => {
      socket.off("receive_message");
      socket.off('load_history'); // Importante limpar este listener
      socket.off('call_ended');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice-candidate');
    };
  }, [room]); // Executa sempre que mudamos de sala

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection(rtcConfig);
    pc.onicecandidate = (event) => {
      if (event.candidate) socket.emit('ice-candidate', { candidate: event.candidate, room });
    };
    pc.ontrack = (event) => { setRemoteStream(event.streams[0]); };
    if (myVideoRef.current && myVideoRef.current.srcObject) {
      myVideoRef.current.srcObject.getTracks().forEach(track => {
        pc.addTrack(track, myVideoRef.current.srcObject);
      });
    }
    peerConnectionRef.current = pc;
    return pc;
  };

  const startCall = async () => {
    setInCall(true);
    setIsRoomCreator(true);
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (myVideoRef.current) myVideoRef.current.srcObject = stream;
    setTimeout(async () => {
      const pc = createPeerConnection();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { offer, room });
    }, 100);
  };

  const joinCall = async () => {
     const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
     if (myVideoRef.current) myVideoRef.current.srcObject = stream;
     stream.getTracks().forEach(track => {
        if (peerConnectionRef.current) peerConnectionRef.current.addTrack(track, stream);
     });
     const pc = peerConnectionRef.current;
     const offer = await pc.createOffer();
     await pc.setLocalDescription(offer);
     socket.emit('offer', { offer, room });
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <h2><Monitor size={24} color="#2563EB" /> CoLab.</h2>
        <div className={room === "Geral" ? "channel active" : "channel"} onClick={() => setRoom("Geral")}>
          <Hash size={18} /> Geral
        </div>
        <div className={room === "Dúvidas" ? "channel active" : "channel"} onClick={() => setRoom("Dúvidas")}>
          <Hash size={18} /> Dúvidas
        </div>
        <div className={room === "Projetos" ? "channel active" : "channel"} onClick={() => setRoom("Projetos")}>
          <Hash size={18} /> Projetos
        </div>
      </div>

      <div className="chat-window">
        <div className="chat-header">
          <div className="header-title"><Hash size={20} color="#2563EB" /> {room}</div>
          
          {!inCall ? (
            <button onClick={startCall} className="btn-primary">
              <Video size={18} /> Iniciar Vídeo
            </button>
          ) : (
            <div style={{display: 'flex', gap: '10px'}}>
               {!isRoomCreator && (
                  <button onClick={joinCall} className="btn-success">
                    <Video size={18} /> Ligar Minha Câmara
                  </button>
               )}
               <button onClick={hangUp} style={{backgroundColor: '#EF4444', color:'white', padding:'8px 15px', borderRadius:'8px', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:'8px', fontWeight:'600'}}>
                 <PhoneOff size={18} /> Sair
               </button>
            </div>
          )}
        </div>

        {inCall && (
          <div className="video-grid">
            <div className="video-card">
              <video ref={myVideoRef} autoPlay playsInline muted />
              <div className="user-label"> <User size={12} /> Eu (Local)</div>
            </div>
            <div className="video-card" style={{ border: remoteStream ? '2px solid #10B981' : '2px dashed #444' }}>
              <video ref={remoteVideoRef} autoPlay playsInline muted />
              {!remoteStream && <p style={{color:'#666', position:'absolute', top:'50%', left:'30%'}}>À espera...</p>}
              <div className="user-label">Colega</div>
            </div>
          </div>
        )}

        {/* --- LISTA DE MENSAGENS --- */}
        <div className="chat-body">
          {messageList
            // O filtro aqui é importante, mas o load_history já traz só as da sala certa
            // Mantemos o filtro por segurança para mensagens em tempo real
            .filter((msg) => msg.room === room) 
            .map((msg, index) => (
            <div className="message-container" id={username === msg.author ? "you" : "other"} key={index}>
              <div className="message-content">
                <p>{msg.message}</p>
              </div>
              <div className="message-meta">
                <span>{msg.author}</span> • <span>{msg.time}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="chat-footer">
          <div className="input-wrapper">
            <input 
              type="text" 
              value={currentMessage} 
              placeholder={`Escreve uma mensagem em #${room}...`} 
              onChange={(e) => setCurrentMessage(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && sendMessage()} 
            />
          </div>
          <button onClick={sendMessage} className="btn-icon">
             <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;