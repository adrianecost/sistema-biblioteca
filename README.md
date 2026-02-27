# Sistema de Gestão de Biblioteca (Projeto CRUD Final)

Este projeto é um sistema completo de gerenciamento de biblioteca, focado em regras de negócio realistas, controle de estoque e segurança de dados.

## Guia de Execução (Passo a Passo)

Siga esta ordem exata para garantir que o sistema funcione corretamente:

### 1. Preparação do Banco de Dados
1.  Abra o **MySQL Workbench**.
2.  Certifique-se de que sua instância local está ativa.
3.  Importe e execute o arquivo `biblioteca_db.sql` (localizado na raiz deste projeto). Isso criará as tabelas, as Triggers de estoque e os dados de teste.

### 2. Configuração do Backend (API)
1.  Abra a pasta `backend` no seu VS Code.
2.  Instale as dependências executando no terminal:
    ```bash
    npm install
    ```
3.  **Variáveis de Ambiente:** - Na pasta `backend`, crie um arquivo chamado `.env`.
    - Use o arquivo `.env.example` como guia.
    - Insira a sua senha do MySQL no campo `DB_PASS` (Ex: `DB_PASS=sua_senha`).
4.  **Iniciar o Servidor:** No terminal da pasta `backend`, digite:
    ```bash
    npm run dev
    ```
5.  **Confirmação:** O terminal deve exibir a mensagem: `✅ API rodando em http://localhost:3000`.

### 3. Execução do Frontend
1.  Com o backend rodando, vá até a pasta `frontend`.
2.  Clique com o botão direito no arquivo `index.html`.
3.  Selecione **"Open with Live Server"**. 
    *⚠️ Importante: Use sempre o Live Server para evitar bloqueios de segurança (CORS) do navegador.*

---
## Interface do Sistema
<img width="1658" height="905" alt="Captura de tela 2026-02-25 233813" src="https://github.com/user-attachments/assets/b8d676af-8716-4c85-ade2-5a2ec5bf1411" />
<img width="688" height="619" alt="Captura de tela 2026-02-25 234106" src="https://github.com/user-attachments/assets/b88a9851-a41b-4519-b161-8c1d16638aef" />
<img width="805" height="727" alt="Captura de tela 2026-02-25 234144" src="https://github.com/user-attachments/assets/229e2cde-417f-4eaf-a111-f50de841d308" />
<img width="993" height="805" alt="Captura de tela 2026-02-25 234234" src="https://github.com/user-attachments/assets/0b2255a5-4a09-4d75-9aad-bf811b2bd3dc" />

---

## Níveis de Acesso e Permissões

O sistema possui quatro perfis de usuário com regalias distintas:

### Administrador (ADMIN)
* **Controle Total:** Possui acesso a todas as abas do sistema.
* **Gestão de Usuários:** Único perfil que pode visualizar, criar ou editar outros usuários.
* **Manutenção:** Pode gerenciar livros, empréstimos e reservas sem restrições.

### Bibliotecário (BIBLIOTECARIO)
* **Gestão Operacional:** Gerencia o acervo (Criar/Editar/Excluir livros).
* **Controle de Fluxo:** Responsável por realizar novos empréstimos e alterar o status para "DEVOLVIDO".
* **Visualização:** Pode ver a lista de todos os empréstimos de todos os alunos.

### Aluno (ALUNO)
* **Consulta e Reserva:** Visualiza o catálogo completo e pode reservar livros (mesmo sem estoque).
* **Privacidade:** Na aba de Empréstimos, visualiza **apenas os seus próprios dados**.
* **Restrições:** Não pode editar livros, nem ver empréstimos de outros alunos ou gerenciar usuários.

### Visitante (VISITANTE)
* **Visualização de Acervo:** Pode navegar pelo catálogo, ver capas, sinopses e disponibilidade.
* **Sem Ação:** Não possui permissão para realizar reservas ou pegar livros emprestados (precisa se tornar ALUNO na secretaria).

---

## Regras de Negócio e Multas

* **Prazos:** O sistema aceita empréstimos por um período máximo de 1 mês.
* **Multa de Atraso:** Caso o livro não seja devolvido no prazo, é aplicada uma multa de **R$ 1,00 por mês** de atraso (calculada automaticamente por comparação de datas).
* **Bloqueio de Inadimplência:** Alunos com livros atrasados ou multas pendentes são automaticamente impedidos pelo sistema de realizar novas reservas ou novos empréstimos até regularizarem a situação.
* **Estoque Automático:** Implementado via Triggers no MySQL. O estoque baixa ao emprestar e repõe automaticamente ao marcar como devolvido.

---

## Credenciais de Teste
* **ADMIN:** `admin@teste.com` | Senha: `123`
* **BIBLIOTECÁRIO:** `biblio@teste.com` | Senha: `123`
* **ALUNO:** `aluno1@gmail.com` | Senha: `123`
