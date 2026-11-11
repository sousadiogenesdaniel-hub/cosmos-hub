# Cosmos Hub

Seu hub pessoal de estudo: **biblioteca de PDFs/Word → flashcards → revisão espaçada → evolução**.

## O que tem na fase 1

- **Biblioteca**: upload de PDF e Word (.docx) pelo navegador, organizados por tipo (livro, artigo, relatório, norma…), matéria e tags. Leitor no próprio app que retoma da última página.
- **Do texto ao card**: selecione um trecho e clique em **⚡ Gerar flashcard**. O editor abre num painel ao lado do livro, com a frente já preenchida. Com o painel aberto, novas seleções podem ir para **→ Frente** ou **→ Verso**.
- **PDF escaneado**: use **✂ Recortar área** e arraste um retângulo na página. O recorte vira imagem na frente do card.
- **Flashcards**: decks e subdecks; tipos *Básico*, *Básico + invertido* e *Lacuna* (`{{c1::texto}}`); agendamento **FSRS** (o algoritmo moderno de repetição espaçada, o mesmo do Anki atual), mirando 90% de retenção.
- **Áudio**: grave áudio na frente e no verso. O **modo 🎧 revisão por áudio** toca a pergunta, espera X segundos (15 por padrão) e toca a resposta. Cards sem áudio são lidos pela voz do navegador. Funciona com botões de fone (⏭ = Bom, ⏮ = Errei).
- **YouTube no card**: cole o link (com minuto de início opcional). Na revisão aparece **▶ Ver vídeo**, que abre o player dentro do app.
- **Evolução**: cards por dia/semana/mês, cards por minuto e acertos **por matéria**, páginas e tempo de leitura por arquivo, sequência de dias e **mapa de assiduidade** (verde claro ≥ 50% da meta, verde forte ≥ 100%).
- **Metas**: uma meta diária geral (cards, minutos ou páginas) + **obrigatórios do dia** (ex.: "zerar o deck de Normas", "ler 10 páginas do livro X"), que aparecem como checklist no Início.
- **Perfil**: nome, área, objetivos.

## Colocar no ar (≈ 20 minutos, tudo grátis)

### 1. Supabase (banco de dados, login e arquivos)

1. Crie uma conta em <https://supabase.com> (pode entrar com o GitHub) e clique em **New project**. Escolha um nome (`cosmos-hub`), uma senha de banco (guarde-a) e a região **South America (São Paulo)**.
2. No menu lateral, abra **SQL Editor** → **New query**, cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**. Isso cria as tabelas, a segurança e o armazenamento.
3. Em **Project Settings → API** (ou **Connect**), copie a **Project URL** e a chave **anon public**.
4. Em **Authentication → Sign In / Providers → Email**, desligue **Confirm email** se não quiser confirmar por e-mail (opcional).

### 2. Vercel (hospedagem do site)

1. Suba esta pasta para um repositório **privado** no seu GitHub.
2. Crie uma conta em <https://vercel.com> entrando com o GitHub → **Add New… → Project** → importe o repositório.
3. Em **Environment Variables**, adicione:
   - `VITE_SUPABASE_URL` = a Project URL
   - `VITE_SUPABASE_ANON_KEY` = a chave anon public
4. Clique em **Deploy**. Em ~1 minuto você recebe um endereço tipo `cosmos-hub.vercel.app`.

### 3. Primeiro acesso e trancar a porta

1. Abra o endereço, clique em **Primeiro acesso? Criar conta** e cadastre seu e-mail e senha.
2. Como o app é só seu, volte ao Supabase → **Authentication → Sign In / Providers** e **desligue "Allow new users to sign up"**. A partir daí ninguém mais consegue criar conta, e cada dado já é protegido para ser visto só pelo dono.

Pronto: é só acessar o endereço de qualquer computador ou celular, sem instalar nada.

## Rodar no seu computador (opcional, para desenvolvimento)

```bash
npm install
cp .env.example .env   # e preencha as duas variáveis
npm run dev
```

`npm test` roda os testes da lógica (cloze, FSRS, métricas). `npm run build` gera a versão de produção.

## Limites do plano gratuito

- Supabase: 1 GB de arquivos (livros + áudios + imagens), 50 MB por arquivo, 500 MB de banco. Um áudio de 10 s ocupa ~20–40 KB.
- O projeto gratuito do Supabase **pausa após 7 dias sem uso**. Se acontecer, é só entrar no painel e clicar em *Restore*.

## Ideias para as próximas fases

- IA criando o flashcard a partir do trecho selecionado; listas de exercícios geradas por IA para cada tópico/capítulo.
- OCR para PDFs escaneados (transformar a imagem em texto selecionável).
- Importar/exportar decks (Anki `.apkg`, CSV).
- Avaliar no modo áudio pela voz ("bom", "errei").
- App instalável (PWA) com revisão offline.

## Estrutura

```
supabase/schema.sql      banco, segurança (RLS) e storage
src/lib/                 lógica: FSRS (srs.ts), cloze (cards.ts), métricas (stats.ts), API (api.ts)
src/components/          leitor de PDF/Word, editor de card, gravador de áudio, gráficos
src/pages/               Início, Biblioteca, Leitor, Flashcards, Estudo, Áudio, Evolução, Perfil
```
