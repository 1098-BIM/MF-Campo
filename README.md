# MF Campo

App de campo da Minerbo-Fuchs Engenharia para registrar incompatibilidades em obra (fotos, áudio, GPS), com painel de gestão e relatório.

- Site estático publicado pelo GitHub Pages (workflow em `.github/workflows/deploy.yml`).
- Dados, login e arquivos no Supabase (estrutura em `banco.sql`).
- `config.js` guarda apenas chaves públicas. Chaves secretas ficam nos *Secrets* do repositório.

Fases seguintes: transcrição automática dos áudios (GitHub Actions + API de transcrição) e integração com Autodesk Build (Issues/RFIs via APS).
