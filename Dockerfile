FROM apify/actor-node-basic
ENV NODE_ENV=production
COPY package.json ./package.json
RUN npm install --production --no-optional
COPY main.js ./main.js
