FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Debug intensif - pour voir ce qui se passe
RUN echo "=== Contenu de /app ===" && ls -la
RUN echo "=== Contenu de dist ===" && ls -la dist/ || echo "PAS DE DIST"
RUN echo "=== Type du fichier ===" && file dist/index.cjs || echo "FICHIER INTROUVABLE"

EXPOSE 5000

# Démarrage avec vérification
CMD ["sh", "-c", "echo '🔍 Vérification...' && test -f dist/index.cjs && echo '✅ Fichier trouvé' && node dist/index.cjs || echo '❌ Fichier introuvable ou crash'"]