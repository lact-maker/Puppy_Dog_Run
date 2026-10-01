FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY server ./server
COPY public ./public
RUN mkdir data && chown node:node data
USER node
ENV PORT=8787
EXPOSE 8787
VOLUME ["/app/data"]
CMD ["node", "server/index.mjs"]
