# Painel no Google Cloud Run (nuvem/ponte.cjs explica o desenho).
# Uma imagem só para os três sistemas: o sistema sai do endereço de cada acesso.
#
# Montar e publicar: node nuvem/publicar.mjs (docs/HOSPEDAGEM.md).

FROM node:24-slim AS montagem
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# As chaves públicas do Supabase (NEXT_PUBLIC_*) entram no código na montagem,
# lidas do .env.local; as secretas vêm do Cloud Run, na execução.
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=montagem /app/.next/standalone ./
COPY --from=montagem /app/.next/static ./.next/static
COPY --from=montagem /app/public ./public
COPY nuvem/ponte.cjs ./ponte.cjs
# Nenhum arquivo de chaves na imagem.
RUN rm -f .env .env.* .dev.vars
USER node
EXPOSE 8080
CMD ["node", "ponte.cjs"]
