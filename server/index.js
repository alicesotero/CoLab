const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();

// Aumentar o limite para aceitar ficheiros grandes (até 50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());


const MONGO_URL = "mongodb+srv://CoLabAdmin:Z820v6ezLrGAmcoP@colabadmin.qwlqrwq.mongodb.net/test?retryWrites=true&w=majority&appName=CoLabAdmin";

mongoose.connect(MONGO_URL)
  .then(() => console.log('✅ MONGODB CONECTADO'))
  .catch((err) => console.error('❌ ERRO MONGODB:', err));


const messageSchema = new mongoose.Schema({
  room: String,
  author: String,
  message: String,
  time: String,
  // O campo file TEM de ser um objeto, não pode ser String
  file: {
    name: { type: String },
    type: { type: String },
    content: { type: String } // Base64
  },
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  password: { type: String, required: true },
  phoneNumber: { type: String },
  isAdmin: { type: Boolean, default: false },
  allowedRooms: { type: [String], default: ['Geral'] }, 
  pendingRequests: { type: [String], default: [] }      
});
const User = mongoose.model('User', userSchema);

const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e8 // Aumentar limite do Socket (100 MB)
});

io.on('connection', (socket) => {
  // --- AUTENTICAÇÃO ---
  socket.on('register_user', async (data) => {
    try {
      const { username, password, firstName, lastName, phoneNumber } = data;
      const existingUser = await User.findOne({ username });
      if (existingUser) { socket.emit('auth_error', 'Utilizador já existe!'); return; }

      const isAdmin = username.toLowerCase() === 'admin';
      const allowedRooms = isAdmin ? ['Geral', 'Dúvidas', 'Projetos'] : ['Geral'];

      const newUser = new User({ username, password, firstName, lastName, phoneNumber, isAdmin, allowedRooms });
      await newUser.save();
      
      socket.emit('auth_success', { 
        username, firstName, lastName, phoneNumber, isAdmin, allowedRooms, pendingRequests: [],
        message: 'Conta criada!' 
      });
    } catch (err) { socket.emit('auth_error', 'Erro ao criar conta.'); }
  });

  socket.on('login_user', async (data) => {
    try {
      const { username, password } = data;
      const user = await User.findOne({ username });
      if (!user || user.password !== password) { socket.emit('auth_error', 'Dados incorretos.'); return; }

      socket.emit('auth_success', { 
        username, firstName: user.firstName, lastName: user.lastName, 
        phoneNumber: user.phoneNumber || "", 
        isAdmin: user.isAdmin,
        allowedRooms: user.allowedRooms,
        pendingRequests: user.pendingRequests,
        message: 'Bem-vindo!' 
      });
    } catch (err) { socket.emit('auth_error', 'Erro no servidor.'); }
  });

  // --- ADMINISTRAÇÃO ---
  socket.on('get_all_users', async () => {
    const users = await User.find({}, 'username firstName lastName allowedRooms pendingRequests');
    socket.emit('all_users_data', users);
  });

  socket.on('toggle_permission', async (data) => {
    const { targetUsername, room, action } = data; 
    try {
      const user = await User.findOne({ username: targetUsername });
      if (user) {
        if (action === 'grant') {
           if (!user.allowedRooms.includes(room)) user.allowedRooms.push(room);
           user.pendingRequests = user.pendingRequests.filter(r => r !== room);
        } else {
           user.allowedRooms = user.allowedRooms.filter(r => r !== room);
        }
        await user.save();
        const users = await User.find({}, 'username firstName lastName allowedRooms pendingRequests');
        socket.emit('all_users_data', users);
        io.emit('permissions_updated', { username: targetUsername, allowedRooms: user.allowedRooms });
      }
    } catch (err) { console.error(err); }
  });

  socket.on('request_access', async (data) => {
    const { username, room } = data;
    try {
      const user = await User.findOne({ username });
      if (user && !user.pendingRequests.includes(room)) {
        user.pendingRequests.push(room);
        await user.save();
      }
    } catch(err) { console.error(err); }
  });

  socket.on('admin_delete_user', async (targetUsername) => {
    try {
      await User.findOneAndDelete({ username: targetUsername });
      const users = await User.find({}, 'username firstName lastName allowedRooms pendingRequests');
      socket.emit('all_users_data', users);
      socket.emit('admin_action_success', `O utilizador ${targetUsername} foi eliminado.`);
      io.emit('force_logout_user', targetUsername);
    } catch (err) { console.error(err); }
  });

  // --- UPDATE PHONE & DELETE ACCOUNT ---
  socket.on('update_phone', async (data) => {
      const { username, phoneNumber } = data;
      await User.findOneAndUpdate({ username }, { phoneNumber });
      socket.emit('phone_updated_success', 'Telemóvel atualizado!');
  });
  
  socket.on('delete_account', async (username) => {
      await User.findOneAndDelete({ username });
      socket.emit('account_deleted_success');
  });

  // --- CHAT (AGORA SUPORTA FICHEIROS) ---
  socket.on('join_room', async (room) => {
    socket.join(room);
    try {
      // Limite 50 mensagens para não pesar
      const history = await Message.find({ room: room }).sort({ createdAt: 1 }).limit(50);
      socket.emit('load_history', history);
    } catch (err) { console.error(err); }
  });

  socket.on('send_message', async (data) => {
    console.log("Recebida mensagem com ficheiro?", !!data.file); // Log para debug
    try {
      const newMessage = new Message(data); 
      await newMessage.save(); 
      socket.to(data.room).emit('receive_message', data);
    } catch (error) {
      console.error("ERRO AO GUARDAR MENSAGEM:", error);
    }
  });

  // WebRTC
  socket.on('offer', (p) => socket.to(p.room).emit('offer', p));
  socket.on('answer', (p) => socket.to(p.room).emit('answer', p));
  socket.on('ice-candidate', (p) => socket.to(p.room).emit('ice-candidate', p));
  socket.on('end_call', (r) => socket.to(r).emit('call_ended'));
});

server.listen(3001, () => console.log('🚀 SERVIDOR ADMIN PRONTO'));