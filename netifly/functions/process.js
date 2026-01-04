const busboy = require('busboy');
const { HfInference } = require('@huggingface/inference');
const fetch = require('node-fetch');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Méthode non autorisée' };

  return new Promise((resolve) => {
    const bb = busboy({ headers: event.headers });
    let fileBuffers = [];

    bb.on('file', (name, file) => {
      const chunks = [];
      file.on('data', chunk => chunks.push(chunk));
      file.on('end', () => fileBuffers.push(Buffer.concat(chunks)));
    });

    bb.on('finish', async () => {
      if (!fileBuffers.length) return resolve({ statusCode: 400, body: JSON.stringify({error: 'Pas de photo'}) });

      try {
        // Prend la première photo pour analyse
        const fileBuffer = fileBuffers[0];

        // 1. Identification (modèles rapides : Florence-2 pour caption, YOLOv8n pour détection)
        const hf = new HfInference(process.env.HF_TOKEN);
        const caption = await hf.imageToText({ data: fileBuffer, model: 'microsoft/Florence-2-base' });
        const detection = await hf.objectDetection({ data: fileBuffer, model: 'ultralytics/yolov8n' });
        const produit = caption.generated_text || detection.map(d => d.label).join(', ') || 'Article inconnu';

        // Suggestion catégorie
        let categorie = 'Vêtements femmes';
        if (produit.toLowerCase().includes('shoe') || produit.includes('chaussure')) categorie = 'Chaussures femmes';
        if (produit.toLowerCase().includes('bag') || produit.includes('sac')) categorie = 'Sacs femmes';

        // 2. Scraping Vinted (remplace vinted-api)
        const vintedUrl = `https://www.vinted.fr/catalog?search_text=${encodeURIComponent(produit)}`;
        const vintedRes = await fetch(vintedUrl);
        const vintedHtml = await vintedRes.text();
        const prixVintedMatches = vintedHtml.match(/€\s*([\d.,]+)/g) || [];
        const prixVinted = prixVintedMatches.slice(0, 20).map(p => parseFloat(p.replace(/[^0-9.]/g, ''))).filter(p => !isNaN(p));
        const moyenneVinted = prixVinted.length ? (prixVinted.reduce((a,b)=>a+b,0)/prixVinted.length).toFixed(2) : 'N/A';

        // 3. Scraping eBay (amélioré)
        const ebayUrl = `https://www.ebay.fr/sch/i.html?_nkw=${encodeURIComponent(produit)}&_sacat=0&_pgn=1`;
        const ebayRes = await fetch(ebayUrl);
        const ebayHtml = await ebayRes.text();
        const prixEbayMatches = ebayHtml.match(/€\s*([\d.,]+)/g) || [];
        const prixEbay = prixEbayMatches.slice(0, 20).map(p => parseFloat(p.replace(/[^0-9.]/g, ''))).filter(p => !isNaN(p));
        const moyenneEbay = prixEbay.length ? (prixEbay.reduce((a,b)=>a+b,0)/prixEbay.length).toFixed(2) : 'N/A';

        const moyenneGlobale = ((parseFloat(moyenneVinted) || 0) + (parseFloat(moyenneEbay) || 0)) / 2;

        // 4. Génération texte (Groq)
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.GROQ_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'llama3-8b-8192',
            messages: [{ role: 'user', content: `Crée un titre court (max 80 chars) et une description détaillée pour Vinted sur : ${produit}. Prix moyen : ${moyenneGlobale.toFixed(2)}€. Ajoute état neuf, taille estimée si possible, emojis pour attractivité.` }]
          })
        });
        if (!groqRes.ok) throw new Error('Erreur Groq : ' + await groqRes.text());
        const groqData = await groqRes.json();
        const texte = groqData.choices[0].message.content.trim();

        const prixSuggere = moyenneGlobale > 0 ? (moyenneGlobale * 0.9).toFixed(2) : '15.00';

        resolve({
          statusCode: 200,
          body: JSON.stringify({
            titre: texte.split('\n')[0].replace('Titre :', '').trim(),
            description: texte.split('\n').slice(1).join('\n').replace('Description :', '').trim(),
            categorie,
            prix: prixSuggere,
            conseil: `Prix moyen Vinted : ${moyenneVinted}€ | eBay : ${moyenneEbay}€. Copie dans Vinted !`
          })
        });
      } catch (err) {
        console.error(err);
        resolve({ statusCode: 500, body: JSON.stringify({error: `Erreur : ${err.message}`}) });
      }
    });

    bb.end(event.body);
  });
};
