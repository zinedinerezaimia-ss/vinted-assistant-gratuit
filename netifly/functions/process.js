const busboy = require('busboy');
const { HfInference } = require('@huggingface/inference');
const fetch = require('node-fetch');
const vinted = require('vinted-api');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Méthode non autorisée' };

  return new Promise((resolve) => {
    const bb = busboy({ headers: event.headers });
    let files = [];

    bb.on('file', (name, file) => {
      const chunks = [];
      file.on('data', chunk => chunks.push(chunk));
      file.on('end', () => files.push(Buffer.concat(chunks)));
    });

    bb.on('finish', async () => {
      if (!files.length) return resolve({ statusCode: 400, body: JSON.stringify({error: 'Pas de photo uploadée'}) });

      try {
        const fileBuffer = files[0]; // Analyse la première photo

        // 1. Identification (avec fallback)
        let produit = 'Article mode inconnu';
        try {
          const hf = new HfInference(process.env.HF_TOKEN);
          const detection = await hf.objectDetection({ data: fileBuffer, model: 'ultralytics/yolov8s' });
          const caption = await hf.imageToText({ data: fileBuffer, model: 'Salesforce/blip-image-captioning-base' });
          produit = caption.generated_text || detection.map(d => d.label).join(', ');
        } catch (hfErr) {
          console.error('HF error:', hfErr);
        }

        // Catégorie suggestion
        let categorie = 'Vêtements femmes';
        if (produit.toLowerCase().includes('shoe') || produit.includes('chaussure')) categorie = 'Chaussures femmes';
        // Ajoute plus

        // 2. Prix Vinted (avec fallback)
        let moyenneVinted = 'N/A';
        try {
          const resultsVinted = await vinted.search({ query: produit, per_page: 20 });
          const prixVinted = resultsVinted.items.map(i => parseFloat(i.price)).filter(p => !isNaN(p));
          moyenneVinted = prixVinted.length ? (prixVinted.reduce((a,b)=>a+b,0)/prixVinted.length).toFixed(2) : 'N/A';
        } catch (vintedErr) {
          console.error('Vinted error:', vintedErr);
        }

        const moyenneGlobale = parseFloat(moyenneVinted) || 20; // Fallback à 20€

        // 3. Texte Groq (avec fallback)
        let texte = 'Titre : Produit générique\nDescription : Description par défaut.';
        try {
          const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.GROQ_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'llama3-8b-8192',
              messages: [{ role: 'user', content: `Crée un titre court et une description pour Vinted sur : ${produit}. Prix moyen : ${moyenneGlobale.toFixed(2)}€.` }]
            })
          });
          if (!groqRes.ok) throw new Error(await groqRes.text());
          const groqData = await groqRes.json();
          texte = groqData.choices[0].message.content.trim();
        } catch (groqErr) {
          console.error('Groq error:', groqErr);
        }

        const prixSuggere = (moyenneGlobale * 0.9).toFixed(2);

        resolve({
          statusCode: 200,
          body: JSON.stringify({
            titre: texte.split('\n')[0].replace('Titre :', '').trim(),
            description: texte.split('\n').slice(1).join('\n').replace('Description :', '').trim(),
            categorie,
            prix: prixSuggere,
            conseil: `Prix moyen Vinted : ${moyenneVinted}€. Copie-colle dans Vinted !`
          })
        });
      } catch (err) {
        console.error('Global error:', err);
        resolve({ statusCode: 500, body: JSON.stringify({error: `Erreur interne : ${err.message}`}) });
      }
    });

    bb.end(event.body);
  });
};
