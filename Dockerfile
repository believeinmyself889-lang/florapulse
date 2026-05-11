FROM nginx:1.27-alpine

COPY index.html /usr/share/nginx/html/index.html
COPY flower2.html /usr/share/nginx/html/flower2.html
COPY rice.png /usr/share/nginx/html/rice.png
COPY src /usr/share/nginx/html/src
COPY docs /usr/share/nginx/html/docs

EXPOSE 80
