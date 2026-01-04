<!DOCTYPE html>
<html lang="fr" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VintedAI</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { background-color: #1a1b1e; color: white; }
        .dropzone { border: 2px dashed #00ffff; border-radius: 1rem; padding: 2rem; text-align: center; cursor: pointer; }
        .dropzone:hover { border-color: #00bfff; }
    </style>
</head>
<body class="min-h-screen flex flex-col items-center justify-between p-4">
    <header class="w-full text-center py-4">
        <h1 class="text-2xl font-bold text-cyan-400">🛍️ VintedAI</h1>
    </header>
    <main class="flex-grow w-full max-w-md">
        <p class="text-lg mb-4">1. AJOUTE TA PHOTO</p>
        <div class="dropzone bg-gray-800">
            <span class="text-4xl mb-2">📷</span>
            <p>Clique ou dépose ta photo ici</p>
        </div>
        <input type="file" id="photoInput" accept="image/*" multiple class="hidden">
        <input type="file" id="cameraInput" accept="image/*" capture="user" class="hidden"> <!-- Pour caméra only -->
        <div class="flex gap-2 mt-4">
            <button id="chooseFileBtn" class="flex-1 bg-gray-600 text-white py-2 rounded">Choisir fichier</button>
            <button id="takePhotoBtn" class="flex-1 bg-gray-600 text-white py-2 rounded">Prendre photo</button>
        </div>
        <div id="preview" class="mt-4 flex flex-wrap gap-2"></div>
    </main>
    <footer class="w-full max-w-md">
        <button id="analyzeBtn" class="w-full bg-cyan-500 text-white py-3 rounded-lg font-bold mt-4">Analyser</button>
        <div id="progress" class="hidden mt-4 text-center">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-cyan-400"></div>
            <p>Analyse en cours...</p>
        </div>
        <div id="result" class="mt-4 hidden"></div>
    </footer>

    <script>
        const dropzone = document.querySelector('.dropzone');
        const photoInput = document.getElementById('photoInput');
        const cameraInput = document.getElementById('cameraInput');
        const chooseFileBtn = document.getElementById('chooseFileBtn');
        const takePhotoBtn = document.getElementById('takePhotoBtn');
        const preview = document.getElementById('preview');
        const analyzeBtn = document.getElementById('analyzeBtn');
        const progress = document.getElementById('progress');
        const resultDiv = document.getElementById('result');

        let selectedFiles = [];

        // Boutons pour trigger inputs
        chooseFileBtn.addEventListener('click', () => photoInput.click());
        takePhotoBtn.addEventListener('click', () => cameraInput.click());

        // Changement inputs
        photoInput.addEventListener('change', () => handleFiles(photoInput.files));
        cameraInput.addEventListener('change', () => handleFiles(cameraInput.files));

        // Drop sur dropzone
        dropzone.addEventListener('click', () => photoInput.click()); // Default à fichier
        dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('border-cyan-400'); });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('border-cyan-400'));
        dropzone.addEventListener('drop', e => {
            e.preventDefault();
            dropzone.classList.remove('border-cyan-400');
            handleFiles(e.dataTransfer.files);
        });

        function handleFiles(files) {
            selectedFiles = [...selectedFiles, ...Array.from(files)]; // Support multiple ajouts
            preview.innerHTML = '';
            selectedFiles.forEach(file => {
                const img = document.createElement('img');
                img.src = URL.createObjectURL(file);
                img.classList.add('w-20', 'h-20', 'object-cover', 'rounded');
                preview.appendChild(img);
            });
        }

        analyzeBtn.addEventListener('click', async () => {
            if (!selectedFiles.length) return alert('Ajoute au moins une photo !');
            progress.classList.remove('hidden');
            resultDiv.classList.add('hidden');

            const formData = new FormData();
            selectedFiles.forEach((file, i) => formData.append(`photo${i}`, file));

            try {
                const response = await fetch('/.netlify/functions/process', { method: 'POST', body: formData });
                const text = await response.text(); // D'abord text pour debug
                if (!response.ok) throw new Error(text || 'Erreur serveur');
                const data = JSON.parse(text); // Puis parse
                progress.classList.add('hidden');
                resultDiv.classList.remove('hidden');
                resultDiv.innerHTML = `
                    <div class="bg-gray-800 p-4 rounded-lg">
                        <h3 class="text-lg font-bold mb-2">Résultats (édite si besoin)</h3>
                        <label class="block mb-1">Titre</label>
                        <input type="text" class="w-full bg-gray-700 p-2 rounded mb-2" id="titre" value="${data.titre || 'Titre par défaut'}">
                        <button class="bg-gray-600 py-1 px-2 rounded copy-btn" data-target="titre">Copier</button>
                        <!-- ... (le reste inchangé comme avant) -->
                    </div>
                `;
                // Boutons copier (inchangé)
                document.querySelectorAll('.copy-btn').forEach(btn => { /* ... */ });
            } catch (err) {
                progress.classList.add('hidden');
                resultDiv.classList.remove('hidden');
                resultDiv.innerHTML = `<div class="bg-red-900 p-4 rounded-lg">Erreur : ${err.message}. Vérifie les logs Netlify ou réessaie.</div>`;
            }
        });
    </script>
</body>
</html>
