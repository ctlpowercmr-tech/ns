const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { pool, testerConnexionBDD, initialiserBDD, bcrypt } = require('./database');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'votre_secret_super_securise_2024';

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

let estConnecteBDD = false;
let tentativesConnexion = 0;
const MAX_TENTATIVES = 5;

// Middleware de logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Middleware pour vérifier la connexion BDD
app.use(async (req, res, next) => {
  if (!estConnecteBDD && tentativesConnexion < MAX_TENTATIVES) {
    estConnecteBDD = await testerConnexionBDD();
    tentativesConnexion++;
  }
  
  if (!estConnecteBDD) {
    return res.status(503).json({ 
      success: false, 
      error: 'Base de données non disponible',
      tip: 'La base de données est en cours de démarrage. Réessayez dans quelques secondes.'
    });
  }
  next();
});

// Middleware d'authentification
function authentifierToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Token manquant' });
  }

  jwt.verify(token, JWT_SECRET, (err, utilisateur) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Token invalide' });
    }
    req.utilisateur = utilisateur;
    next();
  });
}

function genererIdCourt() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'TX';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Routes API de base (sans BDD)
app.get('/api/status', (req, res) => {
  res.json({
    status: 'OK',
    service: 'CTL Distributeur API',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    database: estConnecteBDD ? 'CONNECTÉ' : 'DÉCONNECTÉ'
  });
});

app.get('/api/health', async (req, res) => {
  try {
    if (!estConnecteBDD) {
      return res.status(503).json({ 
        status: 'ERROR', 
        message: 'Base de données non disponible',
        database: 'DÉCONNECTÉ'
      });
    }

    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    
    res.json({ 
      status: 'OK', 
      message: 'API et Base de données fonctionnelles',
      timestamp: new Date().toISOString(),
      database: 'CONNECTÉ'
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      message: 'Problème avec la base de données',
      error: error.message,
      database: 'DÉCONNECTÉ'
    });
  }
});

// Routes qui nécessitent la BDD
app.get('/api/boissons', async (req, res) => {
  if (!estConnecteBDD) {
    return res.status(503).json({ 
      success: false, 
      error: 'Base de données non disponible' 
    });
  }

  const boissons = [
    {
      id: 1,
      nom: "Coca-Cola Original",
      prix: 500,
      image: "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400&h=400&fit=crop",
      categorie: "Soda",
      taille: "33cl",
      promotion: false
    },
    {
      id: 2,
      nom: "Pepsi Max",
      prix: 500,
      image: "https://images.unsplash.com/photo-1624555130581-1d9cca1a1a71?w=400&h=400&fit=crop",
      categorie: "Soda",
      taille: "33cl",
      promotion: false
    },
    {
      id: 3,
      nom: "Fanta Orange",
      prix: 450,
      image: "https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=400&h=400&fit=crop",
      categorie: "Soda",
      taille: "33cl",
      promotion: true
    },
    {
      id: 4,
      nom: "Sprite Citron",
      prix: 450,
      image: "https://images.unsplash.com/photo-1631549916768-4119b2e5f926?w=400&h=400&fit=crop",
      categorie: "Soda",
      taille: "33cl",
      promotion: false
    }
  ];
  
  res.json({ success: true, data: boissons });
});

// Routes d'authentification
app.post('/api/inscription', async (req, res) => {
  if (!estConnecteBDD) {
    return res.status(503).json({ 
      success: false, 
      error: 'Base de données non disponible' 
    });
  }

  try {
    const { email, nom, telephone, password } = req.body;
    
    if (!email || !nom || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email, nom et mot de passe requis' 
      });
    }

    const client = await pool.connect();
    
    // Vérifier si l'email existe déjà
    const existe = await client.query(
      'SELECT id FROM utilisateurs WHERE email = $1', 
      [email]
    );
    
    if (existe.rows.length > 0) {
      client.release();
      return res.status(400).json({ 
        success: false, 
        error: 'Email déjà utilisé' 
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await client.query(
      `INSERT INTO utilisateurs (email, nom, telephone, password, solde) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, email, nom, telephone, solde`,
      [email, nom, telephone, hashedPassword, 0.00]
    );
    
    client.release();
    
    const utilisateur = result.rows[0];
    const token = jwt.sign(
      { id: utilisateur.id, email: utilisateur.email }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );
    
    res.json({
      success: true,
      message: 'Compte créé avec succès',
      token,
      utilisateur: {
        id: utilisateur.id,
        email: utilisateur.email,
        nom: utilisateur.nom,
        telephone: utilisateur.telephone,
        solde: parseFloat(utilisateur.solde)
      }
    });
  } catch (error) {
    console.error('Erreur inscription:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur interne du serveur',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/connexion', async (req, res) => {
  if (!estConnecteBDD) {
    return res.status(503).json({ 
      success: false, 
      error: 'Base de données non disponible' 
    });
  }

  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email et mot de passe requis' 
      });
    }

    const client = await pool.connect();
    
    const result = await client.query(
      'SELECT * FROM utilisateurs WHERE email = $1',
      [email]
    );
    
    client.release();
    
    if (result.rows.length === 0) {
      return res.status(401).json({ 
        success: false, 
        error: 'Email ou mot de passe incorrect' 
      });
    }
    
    const utilisateur = result.rows[0];
    const motDePasseValide = await bcrypt.compare(password, utilisateur.password);
    
    if (!motDePasseValide) {
      return res.status(401).json({ 
        success: false, 
        error: 'Email ou mot de passe incorrect' 
      });
    }
    
    const token = jwt.sign(
      { id: utilisateur.id, email: utilisateur.email }, 
      JWT_SECRET, 
      { expiresIn: '24h' }
    );
    
    res.json({
      success: true,
      message: 'Connexion réussie',
      token,
      utilisateur: {
        id: utilisateur.id,
        email: utilisateur.email,
        nom: utilisateur.nom,
        telephone: utilisateur.telephone,
        solde: parseFloat(utilisateur.solde)
      }
    });
  } catch (error) {
    console.error('Erreur connexion:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur interne du serveur' 
    });
  }
});

// Les autres routes (transaction, paiement, etc.) restent similaires mais avec gestion d'erreur améliorée

// Route pour réinitialiser la base (en développement seulement)
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/admin/reset-db', async (req, res) => {
    try {
      const { secret } = req.body;
      if (secret !== 'reset-2024') {
        return res.status(403).json({ success: false, error: 'Accès interdit' });
      }
      
      // Implémentation du reset...
      res.json({ success: true, message: 'Reset initié' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

// Gestion des erreurs 404
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route non trouvée',
    path: req.originalUrl
  });
});

// Gestionnaire d'erreurs global
app.use((error, req, res, next) => {
  console.error('Erreur globale:', error);
  res.status(500).json({
    success: false,
    error: 'Erreur interne du serveur',
    ...(process.env.NODE_ENV === 'development' && { details: error.message })
  });
});

// Maintenance serveur
setInterval(async () => {
  if (estConnecteBDD) {
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
    } catch (error) {
      console.error('❌ Erreur maintenance:', error);
      estConnecteBDD = false;
      tentativesConnexion = 0;
    }
  }
}, 300000);

// Démarrage du serveur
async function demarrerServeur() {
  console.log('🚀 Démarrage du serveur CTL Distributeur...');
  
  try {
    // Initialiser la base de données avec retry
    let bddInitialisee = false;
    let tentatives = 0;
    
    while (!bddInitialisee && tentatives < 3) {
      tentatives++;
      console.log(`🔄 Tentative d'initialisation BDD ${tentatives}/3...`);
      bddInitialisee = await initialiserBDD();
      
      if (!bddInitialisee) {
        console.log(`⏳ Attente avant nouvelle tentative...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    if (!bddInitialisee) {
      console.log('⚠️ Base de données non initialisée, mais le serveur démarre quand même');
    }
    
    // Tester la connexion
    estConnecteBDD = await testerConnexionBDD();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🎉 Serveur backend démarré sur le port ${PORT}`);
      console.log(`📍 URL: http://0.0.0.0:${PORT}`);
      console.log(`🌐 Public: https://ns-0apc.onrender.com`);
      console.log(`✅ PostgreSQL: ${estConnecteBDD ? 'CONNECTÉ' : 'DÉCONNECTÉ'}`);
      console.log(`🔄 Maintenance active: SERVEUR TOUJOURS EN LIGNE`);
      
      if (!estConnecteBDD) {
        console.log('💡 ASTUCE: La base de données peut mettre quelques minutes à être disponible');
        console.log('💡 EXÉCUTEZ: npm run reset-db pour réinitialiser la base si nécessaire');
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur démarrage serveur:', error);
    process.exit(1);
  }
}

demarrerServeur();
