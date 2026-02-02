const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // Aceitar qualquer origem para facilitar testes
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log(`Utilizador conectado: ${socket.id}`);

  // --- PARTE 1: CHAT ---
  socket.on('join_room', (room) => {
    socket.join(room);
    console.log(`User ${socket.id} entrou na sala: ${room}`);
  });

  socket.on('send_message', (data) => {
    // Envia apenas para quem está na mesma sala
    socket.to(data.room).emit('receive_message', data);
  });

  // --- PARTE 2: VÍDEO (SIGNALING) ---
  // Quando alguém quer ligar (envia a "proposta" para a sala)
  socket.on('offer', (payload) => {
    socket.to(payload.room).emit('offer', payload);
  });

  // Quando alguém atende (envia a "resposta" de volta)
  socket.on('answer', (payload) => {
    socket.to(payload.room).emit('answer', payload);
  });

  // Troca de informações de rede (caminhos possíveis)
  socket.on('ice-candidate', (payload) => {
    socket.to(payload.room).emit('ice-candidate', payload);
  });

  // Quando alguém desliga a chamada
  socket.on('end_call', (room) => {
    // Avisa a outra pessoa na sala que a chamada acabou
    socket.to(room).emit('call_ended');
  });
  
});

server.listen(3001, () => {
  console.log('✅ SERVIDOR MULTIMÉDIA A CORRER NA PORTA 3001');
});