FROM node:latest

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

COPY check_env.sh ./
RUN chmod +x check_env.sh

EXPOSE 4000
CMD ["./check_env.sh"]
