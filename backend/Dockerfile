FROM node:18-alpine

# Crear directorio de trabajo
WORKDIR /usr/src/app

# Copiar archivos de dependencia
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar el código fuente del backend
COPY . .

# Exponer el puerto del servidor Express
EXPOSE 3000

# Comando por defecto (producción). En desarrollo docker-compose lo sobreescribe con 'npm run dev'
CMD ["npm", "start"]
