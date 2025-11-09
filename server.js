const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { pool, testerConnexionBDD, initialiserBDD, supprimerTables } = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'votre_secret_super_securise_changez_moi';

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Variables globales
let estConnecteBDD = false;
let tentativesConnexion = 0;
const MAX_TENTATIVES = 5;

// Middleware de connexion BDD avec reconnexion automatique
app.use(async (req, res, next) => {
  if (!estConnecteBDD && tentativesConnexion < MAX_TENTATIVES) {
    console.log(`🔄 Tentative connexion BDD (${tentativesConnexion + 1}/${MAX_TENTATIVES})...`);
    estConnecteBDD = await testerConnexionBDD();
    tentativesConnexion++;
  }

  if (!estConnecteBDD) {
    return res.status(503).json({
      success: false,
      error: 'Service temporairement indisponible',
      code: 'DATABASE_UNAVAILABLE'
    });
  }
  
  next();
});

// Middleware d'authentification
function authentifierToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Token d\'authentification manquant',
      code: 'MISSING_TOKEN'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, utilisateur) => {
    if (err) {
      return res.status(403).json({
        success: false,
        error: 'Token invalide ou expiré',
        code: 'INVALID_TOKEN'
      });
    }
    req.utilisateur = utilisateur;
    next();
  });
}

// Génération d'ID court robuste
function genererIdCourt() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `TX${timestamp}${random}`.toUpperCase().substring(0, 20);
}

// ==================== ROUTES API ====================

// Route santé améliorée
app.get('/api/health', async (req, res) => {
  try {
    const client = await pool.connect();
    const dbResult = await client.query('SELECT NOW() as time, version() as version');
    client.release();

    res.json({
      success: true,
      status: 'OK',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        time: dbResult.rows[0].time,
        version: dbResult.rows[0].version
      },
      service: 'CTL Distributeur API',
      version: '2.0.0'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'ERROR',
      error: 'Database connection failed',
      timestamp: new Date().toISOString()
    });
  }
});

// Route de reset (seulement en développement)
app.post('/api/admin/reset-db', async (req, res) => {
  if (process.env.NODE_ENV !== 'production') {
    try {
      await supprimerTables();
      await initialiserBDD();
      res.json({ success: true, message: 'Base de données réinitialisée' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  } else {
    res.status(403).json({ success: false, error: 'Non autorisé en production' });
  }
});

// Routes d'authentification (garder le même code que précédemment)
app.post('/api/inscription', async (req, res) => {
  try {
    const { email, nom, telephone, password } = req.body;
    
    if (!email || !nom || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email, nom et mot de passe requis',
        code: 'MISSING_FIELDS'
      });
    }

    const client = await pool.connect();
    
    // Vérifier si l'email existe
    const existe = await client.query(
      'SELECT id FROM utilisateurs WHERE email = $1',
      [email]
    );
    
    if (existe.rows.length > 0) {
      client.release();
      return res.status(400).json({
        success: false,
        error: 'Un compte avec cet email existe déjà',
        code: 'EMAIL_EXISTS'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    
    const result = await client.query(
      `INSERT INTO utilisateurs (email, nom, telephone, password) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, email, nom, telephone, solde`,
      [email, nom, telephone, hashedPassword]
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
      error: 'Erreur lors de la création du compte',
      code: 'REGISTRATION_ERROR'
    });
  }
});

// ... (garder le reste du code des routes comme précédemment)

// Route pour obtenir les boissons
app.get('/api/boissons', async (req, res) => {
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

// Gestion des erreurs globale
app.use((error, req, res, next) => {
  console.error('❌ Erreur globale:', error);
  res.status(500).json({
    success: false,
    error: 'Erreur interne du serveur',
    code: 'INTERNAL_ERROR'
  });
});

// Route 404
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route non trouvée',
    code: 'ROUTE_NOT_FOUND'
  });
});

// Démarrage robuste du serveur
async function demarrerServeur() {
  console.log('🚀 Démarrage du serveur CTL Distributeur...');
  
  try {
    // Initialiser la BDD
    console.log('📦 Initialisation de la base de données...');
    const bddInitialisee = await initialiserBDD();
    
    if (!bddInitialisee) {
      throw new Error('Impossible d\'initialiser la base de données');
    }

    // Tester la connexion
    estConnecteBDD = await testerConnexionBDD();
    
    if (!estConnecteBDD) {
      throw new Error('Impossible de se connecter à la base de données');
    }

    // Démarrer le serveur
    app.listen(PORT, '0.0.0.0', () => {
      console.log('🎉 Serveur démarré avec succès!');
      console.log(`📍 URL: http://0.0.0.0:${PORT}`);
      console.log(`🌐 Disponible sur: https://votre-url.render.com`);
      console.log(`📊 Base de données: ${estConnecteBDD ? 'CONNECTÉE' : 'DÉCONNECTÉE'}`);
      console.log('🔄 Maintenance active - Serveur toujours en ligne');
      console.log('===============================================');
    });

  } catch (error) {
    console.error('❌ Erreur démarrage serveur:', error);
    console.log('🔄 Nouvelle tentative dans 10 secondes...');
    setTimeout(demarrerServeur, 10000);
  }
}

// Démarrer le serveur
demarrerServeur();

// Maintenance périodique
setInterval(async () => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('🔄 Maintenance serveur OK -', new Date().toISOString());
  } catch (error) {
    console.error('❌ Erreur maintenance:', error);
    estConnecteBDD = false;
    tentativesConnexion = 0;
  }
}, 300000); // 5 minutes
