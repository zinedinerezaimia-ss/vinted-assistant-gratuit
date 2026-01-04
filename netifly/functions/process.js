const busboy = require('busboy');
const { HfInference } = require('@huggingface/inference');
const fetch = require('node-fetch');
const vinted = require('vinted-api');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Méthode non autorisée' };

  return new Promise((resolve) => {
    const bb = busboy({ headers: event.headers });
    let fileBuffer;

    bb.on('file', (name, file) => {
      const chunks = [];
      file.on('data', chunk => chunks.push(chunk));
      file.on('end', () => { fileBuffer = Buffer.concat(chunks); });
    });

    bb.on('finish', async () => {
      if (!fileBuffer) return resolve({ statusCode: 400, body: JSON.stringify({error: 'Pas de photo uploadée'}) });

      try {
        // 1. Identification produit (Hugging Face avec ton token via env)
        const hf = new HfInference(process.env.HF_TOKEN);
        const detection = await hf.objectDetection({ data: fileBuffer, model: 'facebook/detr-resnet-50' });
        const caption = await hf.imageToText({ data: fileBuffer, model: 'Salesforce/blip-image-captioning-base' });
        const produit = caption.generated_text || detection.map(d => d.label).join(', ') || 'Article mode inconnu';

        // 2. Recherche prix Vinted
        const resultsVinted = await vinted.search({ query: produit, per_page: 20 });
        const prixVinted = resultsVinted.items.map(i => parseFloat(i.price)).filter(p => !isNaN(p));
        const moyenneVinted = prixVinted.length ? (prixVinted.reduce((a,b)=>a+b,0)/prixVinted.length).toFixed(2) : 'N/A';

        // 3. Comparaison eBay (recherche publique simple sans key, via fetch + parsing basique)
        const ebayUrl = `https://www.ebay.fr/sch/i.html?_nkw=${encodeURIComponent(produit)}&_sacat=0&_pgn=1`;
        const ebayRes = await fetch(ebayUrl);
        const ebayHtml = await ebayRes.text();
        const prixEbayMatches = ebayHtml.match(/€\s*([\d.,]+)/g) || []; // Regex simple pour extraire prix
        const prixEbay = prixEbayMatches.slice(0, 10).map(p => parseFloat(p.replace(/[^0-9.]/g, ''))).filter(p => !isNaN(p));
        const moyenneEbay = prixEbay.length ? (prixEbay.reduce((a,b)=>a+b,0)/prixEbay.length).toFixed(2) : 'N/A';

        // Moyenne globale
        const moyenneGlobale = ((parseFloat(moyenneVinted) || 0) + (parseFloat(moyenneEbay) || 0)) / 2;

        // 4. Génération texte (Groq avec ton token via env)
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.GROQ_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'llama3-8b-8192',
            messages: [{ role: 'user', content: `Crée un titre court et une description attractive pour une annonce Vinted sur : ${produit}. Prix moyen sur Vinted : ${moyenneVinted}€, sur eBay : ${moyenneEbay}€. Rends-la convaincante, ajoute des détails vendeurs comme l'état, la taille si possible, et optimise pour la vente.` }]
          })
        });
        if (!groqRes.ok) throw new Error('Erreur Groq : ' + await groqRes.text());
        const groqData = await groqRes.json();
        const texte = groqData.choices[0].message.content.trim();

        const prixSuggere = moyenneGlobale > 0 ? (moyenneGlobale * 0.9).toFixed(2) : '15-30'; // 10% en dessous pour compétitivité

        resolve({
          statusCode: 200,
          body: JSON.stringify({
            produit,
            titre: texte.split('\n')[0].replace('Titre :', '').trim(),
            description: texte.split('\n').slice(1).join('\n').replace('Description :', '').trim(),
            prix: prixSuggere,
            conseil: `Prix moyen Vinted : ${moyenneVinted}€ | eBay : ${moyenneEbay}€`
          })
        });
      } catch (err) {
        console.error(err);
        resolve({ statusCode: 500, body: JSON.stringify({error: `Erreur interne : ${err.message}`}) });
      }
    });

    bb.end(event.body);
  });
};
