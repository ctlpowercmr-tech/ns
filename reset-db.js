const { supprimerTables, initialiserBDD, testerConnexionBDD } = require('./database');

async function resetBaseDeDonnees() {
  console.log('🔄 RESET COMPLET DE LA BASE DE DONNÉES...');
  
  try {
    // Tester la connexion
    const connexionOK = await testerConnexionBDD();
    if (!connexionOK) {
      console.error('❌ Impossible de se connecter à la BDD');
      process.exit(1);
    }

    // Supprimer les tables
    const suppressionOK = await supprimerTables();
    if (!suppressionOK) {
      console.error('❌ Échec suppression tables');
      process.exit(1);
    }

    // Réinitialiser
    const initialisationOK = await initialiserBDD();
    if (!initialisationOK) {
      console.error('❌ Échec initialisation BDD');
      process.exit(1);
    }

    console.log('🎉 RESET RÉUSSI! Base de données toute neuve.');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Erreur reset BDD:', error);
    process.exit(1);
  }
}

resetBaseDeDonnees();
