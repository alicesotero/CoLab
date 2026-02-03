const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());

// --- MUDANÇA IMPORTANTE: Adicionei o nome da base de dados no link (test) ---
// Substitui a SENHA abaixo
const MONGO_URL = "mongodb+srv://CoLabAdmin:Z820v6ezLrGAmcoP@colabadmin.qwlqrwq.mongodb.net/?appName=CoLabAdmin";

console.log("⏳ A tentar conectar ao MongoDB...");

mongoose.connect(MONGO_URL)
  .then(() => console.log('✅✅✅ CONEXÃO MONGODB BEM SUCEDIDA! ✅✅✅'))
  .catch((err) => {
    console.error('❌❌❌ ERRO CRÍTICO NO MONGODB ❌❌❌');
    console.error(err);
  });

const messageSchema = new mongoose.Schema({
  room: String,
  author: String,
  message: String,
  time: String,
  createdAt: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

io.on('connection', (socket) => {
  console.log(`🔌 Novo Cliente Conectado: ${socket.id}`);

  socket.on('join_room', async (room) => {
    console.log(`👉 O user ${socket.id} pediu para entrar na sala: ${room}`);
    socket.join(room);
    
    try {
      console.log(`🔍 A procurar mensagens na BD para a sala: ${room}...`);
      const history = await Message.find({ room: room }).sort({ createdAt: 1 }).limit(50);
      console.log(`📦 Encontrei ${history.length} mensagens antigas. A enviar para o cliente...`);
      socket.emit('load_history', history);
    } catch (err) {
      console.error("❌ Erro ao buscar mensagens:", err);
    }
  });

  socket.on('send_message', async (data) => {
    console.log(`📝 Nova mensagem recebida de ${data.author}: ${data.message}`);
    
    try {
      const newMessage = new Message(data);
      await newMessage.save();
      console.log("💾 Mensagem guardada na BD com sucesso!");
    } catch (error) {
       console.error("❌ Erro ao guardar mensagem na BD:", error);
    }

    socket.to(data.room).emit('receive_message', data);
  });

  // WebRTC e outros eventos
  socket.on('offer', (p) => socket.to(p.room).emit('offer', p));
  socket.on('answer', (p) => socket.to(p.room).emit('answer', p));
  socket.on('ice-candidate', (p) => socket.to(p.room).emit('ice-candidate', p));
  socket.on('end_call', (r) => socket.to(r).emit('call_ended'));
});

server.listen(3001, () => {
  console.log('🚀 SERVIDOR A CORRER NA PORTA 3001');
});