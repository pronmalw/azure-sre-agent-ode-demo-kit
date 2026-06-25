FROM node:20-alpine AS build
WORKDIR /app
ENV NO_COLOR=1
COPY package*.json ./
RUN npm install
COPY . .
RUN npx tsc --noEmit
RUN npx vite build --logLevel warn

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
