# QA Overview

Overview of the QA flow and listing of models/techniques used.

## Overall Flow
```mermaid
flowchart LR
    U[User Query: text + image] --> E[Embedding]
    E --> C[Chunking PDF / Docs]
    C --> R[Hybrid Retrieval: Dense + TF-IDF]
    R --> G[Generator: GPT]
    G --> O[Output: Answer + Citations]
```

## PDF Chunking and Image Extraction

Detailed description of how to chunk PDFs and attach images to chunks.

#### 1. Semantic Chunking

```python
_EMBED_MODEL = "BAAI/bge-small-en-v1.5"
_SPLITTER = SemanticSplitterNodeParser(
    buffer_size=1,
    breakpoint_percentile_threshold=95,
    embed_model=_EMBED_MODEL
)
```

* Split PDF/documents into semantic chunks based on embedding similarity.
* buffer_size=1 prevents information loss when splitting.
* breakpoint_percentile_threshold=95 favors splitting at clear semantic boundaries.

#### 2. Image Extraction

* The `extract_images` function scans Markdown syntax: `![alt](path)` in the text.
* Interpolates `figure_id` near the text chunk to identify which images are related to the text.

#### 3. Attach Images to Chunks

```python
chunks.append({
    "doc_id": doc_id,
    "title": title,
    "page": page,
    "text": chunk_text,
    "images": chunk_images if chunk_images else None
})

* If no related images → "images": None.
* If there are related images → "images" is a list of paths / metadata of the images.

---

#### 4. Flow Chunking + Image Association

```mermaid
flowchart LR
    P[PDF / Document] --> T[Extract Text & Images]
    T --> S[Semantic Chunking using BGE Small + Splitter]
    S --> C[Associate images to nearby text by figure_id]
    C --> O[Chunks: doc_id, title, page, text, images/None]
```

## Multi-Modal Embedding using Visualized BGE

Describes how to create embeddings for **queries and chunks** using the Visualized BGE model for text + image retrieval.

#### 1. Prepare the Model

* Model: [BAAI/bge-visualized](https://huggingface.co/BAAI/bge-visualized)
* Two available weights: `bge-visualized-base-en-v1.5` and `bge-visualized-m3`
* Use `bge-visualized-m3` to support **multi-language**.

```python
import torch
from visual_bge.modeling import Visualized_BGE

# Load the model with the downloaded weight
model = Visualized_BGE(
    model_name_bge="BAAI/bge-base-en-v1.5",
    model_weight="path/to/bge-visualized-m3.pth"
)
model.eval()

#### 2. Create Embedding for Query

```python
with torch.no_grad():
    query_emb = model.encode(text="Are there sidewalks on both sides of the Mid-Hudson Bridge?")

* If only text is available, pass text.
* If both text and image are available, pass both text and the image path.

#### 3. Create Embedding for Candidate Chunks

```python
with torch.no_grad():
    candi_emb_1 = model.encode(
        text="The Mid-Hudson Bridge, spanning the Hudson River between Poughkeepsie and Highland.",
        image="./imgs/wiki_candi_1.jpg"
    )
    candi_emb_2 = model.encode(
        text="Golden_Gate_Bridge",
        image="./imgs/wiki_candi_2.jpg"
    )
    candi_emb_3 = model.encode(
        text="The Mid-Hudson Bridge was designated as a New York State Historic Civil Engineering Landmark by the American Society of Civil Engineers in 1983. The bridge was renamed the \"Franklin Delano Roosevelt Mid-Hudson Bridge\" in 1994."
    )
```

* encode supports text + optional image, enabling multi-modal retrieval.
* If a chunk only has text → pass text.
* If a chunk has both text and image → pass text + image.
* 
## Hybrid Search Flow

Detailed description of **Hybrid Search** in the retrieval pipeline.

#### 1. Processing Steps

1. **Keyword Generation**

   * Use GPT (e.g., `gpt-4`) to generate a list of keywords from the query.

2. **Keyword Search**

   * Retrieve chunks based on TF-IDF similarity with the generated keywords.

3. **Dense Search**

   * Encode the query (text + optional image) into a vector embedding.
   * Compute cosine similarity with the dense vectors of the chunks.

4. **Score Merging**

   * Combine scores: `score = alpha * dense_score + (1 - alpha) * keyword_score`
   * Rank and select the top-k chunks according to the merged score.
 - alpha) * keyword_score`
   * Sắp xếp và chọn top-k chunk theo merged score.

#### 2. Output

* List of **top-k relevant chunks** with:

  * `index` trong corpus
  * `score` (sau khi kết hợp)
  * `text` chunk
  * `metadata` (title, page, images...)

#### 3. Flow Diagram

```mermaid
flowchart LR
    Q[User Query: text + optional image] --> G[Generate Keywords using GPT]
    C[Corpus: TF-IDF + Dense embeddings] --> K[Keyword Search]
    Q --> D[Dense Search]
    K --> M[Merge Scores]
    D --> M
    M --> O[Output: top-k relevant chunks]
```


## Answer Generation Flow (`generate`)

Describes the flow of the `generate` function used to produce answers from contexts (text + optional image) using GPT.

#### 1. Input

* `question`: the user's question (text)
* `contexts`: list of retrieved chunks (text or text + figure)
* `query_image` (optional): image accompanying the question
* `max_tokens`: maximum number of tokens for the model call

#### 2. Processing Steps

**System Prompt Setup**

* Instruct the model to only use information from the `contexts`.
* When using a context, mark it as `[cN]`.
* If the answer is unknown → respond with “I don’t know”.

```python
system = (
    "You are a helpful assistant. Answer strictly using the provided contexts (text and figures). "
    "When referencing a context, add a citation marker like [c1], [c2], ... where the number corresponds to the context index shown. "
    "If unknown, say you don't know."
)

**Call Model (OpenAI Chat Completion)**

   * Model: `self.model` ( `gpt-4o-mini`)
   * Messages: `system` + `user` prompt
   * Parameters: `max_tokens`, `temperature=0.2`

**Extract Answer & Citations**

   * `answer = resp.choices[0].message.content.strip()`
   * Dùng regex `\[c(\d+)\]` để lấy citations `[cN]`
   * Trả về dict:

     ```json
     {
       "answer": "<generated answer>",
       "citations": [list of context indexes]
     }
     ```

#### 3. Output

* `answer`: the answer generated by the model
* `citations`: indices of the contexts referenced in the answer


#### 4. Flow Diagram

```mermaid
flowchart LR
    Q[User Question: text] --> P[Build Prompt]
    C[Retrieved Contexts: text + optional figures] --> P
    P --> M[Call OpenAI GPT Model]
    M --> A[Extract Answer]
    M --> X[Extract Citations cN]
    A --> O[Output: answer + citations]
    X --> O
```

* **Q + C → P**: create a prompt combining the question and contexts  
* **P → M**: send the prompt to GPT  
* **M → A + X**: extract the answer and citations from the model response  
* **A + X → O**: produce the final output returned to the user


# QA Output Comparison: Query With vs Without Image

| Feature | Query without Image | Query with Image |
|---------|-------------------|----------------|
| **Question** | different of this image and method of this paper | different of this image and method of this paper [query_image: cross_attetion] |
| **Generator** | openai | openai |
| **Answer** | I don't know. | The image depicts the architecture of the Transformer model, specifically illustrating the cross-attention mechanism involving queries, keys, and values, which are essential components in the attention mechanism. The encoder output and decoder output interact through these components to produce hidden states, as shown in the diagram.\n\nIn contrast, the methods described in the paper focus on the efficiency of self-attention compared to convolutional layers, highlighting the complexity and interpretability of self-attention models. The paper also discusses multi-head attention, which allows the model to attend to different representation subspaces simultaneously, enhancing its ability to capture various aspects of the input data [c1][c2][c5].\n\nThus, while the image provides a visual representation of the Transformer architecture, the paper elaborates on the theoretical underpinnings and advantages of using self-attention and multi-head attention in model design.\n\nFigures (from retrieved contexts):\n- Figure [url: /static/paperreader/services/parser/output/image_000000_536d6dc5957170c29984f94ad0ddf7c2faaaf2cd88b962d1b385f13acf5ba66f.png] |
| **Cited Sections** |  | - **[c1] 3 Model Architecture** (page 6): Figure 1: The Transformer - model architecture. Stacked self-attention and fully connected layers for encoder and decoder.<br>- **[c2] 3.2.2 Multi-Head Attention** (page 11): Multi-head attention allows attending to multiple representation subspaces. Projections: W_Qi, W_Ki, W_Vi, W_O.<br>- **[c5] 4 Why Self-Attention** (page 16): Convolutional layers more expensive than recurrent; separable convolutions reduce complexity. Self-attention improves interpretability. |

---

### Note image

**Query image:** Cross-Attention Illustration  
![Figure 1](https://github.com/user-attachments/assets/43170c97-2011-4161-b73a-bb79ebe98ac4)

**Figure 1:** Retrieved Chunk Image  
![Figure 1](https://github.com/user-attachments/assets/00a6613c-122c-4c0d-96d8-f085bec5cfe6)


# QA Flow Diagram

## Overview
Flow diagram of the Question Answering (QA) system in PaperReader, from when a user asks a question to receiving an answer with citations.

## Flow Diagram

```mermaid
flowchart TD
    Start([User opens QA Interface]) --> InitSession[Initialize Session]
    
    InitSession --> CheckLocalStorage{Check localStorage<br/>for session_id?}
    CheckLocalStorage -->|Yes| VerifySession[Verify session with backend]
    CheckLocalStorage -->|No| CreateSession[POST /api/chat/sessions<br/>Create new session]
    
    VerifySession -->|Valid session| LoadHistory[Load chat history from backend]
    VerifySession -->|Session not found| CreateSession
    LoadHistory --> SaveToLocal[Save session_id and messages to localStorage]
    
    CreateSession --> SaveSession[Save session_id to localStorage]
    SaveSession --> CheckPipeline[Check Pipeline Status]
    SaveToLocal --> CheckPipeline
    
    CheckPipeline --> PollStatus[GET /api/qa/status<br/>Poll every 2 seconds]
    PollStatus --> PipelineReady{Pipeline ready?}
    PipelineReady -->|Not ready| ShowProgress[Show progress bar<br/>Building index...]
    ShowProgress --> PollStatus
    PipelineReady -->|Ready| ReadyUI[UI ready<br/>Allow question input]
    
    ReadyUI --> UserQuestion[User enters question<br/>and clicks Ask/Send]
    UserQuestion --> ValidateQuestion{Valid question?}
    ValidateQuestion -->|No| ShowError[Show error]
    ValidateQuestion -->|Yes| SendQuestion[POST /api/chat/ask<br/>Send question to backend]
    
    SendQuestion --> BackendReceive[Backend receives request<br/>/api/chat/ask]
    BackendReceive --> GetChatHistory[Get chat history from MongoDB<br/>by session_id]
    GetChatHistory --> GetPipeline[Get/cache QA Pipeline<br/>get_pipeline config]
    
    GetPipeline --> PipelineAnswer[Pipeline.answer<br/>question, chat_history]
    
    PipelineAnswer --> Retrieve[Retrieval Phase]
    Retrieve --> HybridRetrieval[Hybrid Retrieval:<br/>- Dense: Visualized_BGE embeddings<br/>- Sparse: BM25 keyword search<br/>- Fusion: Combine results<br/>- Rerank: Cross-encoder reranking]
    
    HybridRetrieval --> GetTopK[Get top_k chunks<br/>by relevance score]
    GetTopK --> Generate[Generation Phase]
    
    Generate --> LLMGenerate[LLM Generator OpenAI GPT-4:<br/>- Input: question, contexts, chat_history<br/>- Generate: answer with citation markers [cN]<br/>- Output: answer text]
    
    LLMGenerate --> ExtractCitations[Extract Citations:<br/>- Parse [cN] markers from answer<br/>- Map citations with retrieved chunks<br/>- Build cited_sections array]
    
    ExtractCitations --> CalculateConfidence[Calculate confidence score<br/>from retriever scores]
    CalculateConfidence --> SaveMessage[Save message to MongoDB:<br/>- User message<br/>- Assistant message with metadata]
    
    SaveMessage --> ReturnResponse[Return response:<br/>answer, cited_sections, confidence]
    
    ReturnResponse --> FrontendReceive[Frontend receives response]
    FrontendReceive --> CreateQAMessage[Create QAMessage object:<br/>- question<br/>- answer<br/>- cited_sections<br/>- confidence<br/>- timestamp]
    
    CreateQAMessage --> UpdateUI[Update UI:<br/>- Add to messages array<br/>- Display answer<br/>- Display citations<br/>- Display confidence bar]
    
    UpdateUI --> SaveLocalStorage[Save messages to localStorage<br/>to persist across refresh]
    SaveLocalStorage --> NotifyParent[Call onNewMessage callback<br/>if provided]
    NotifyParent --> End([Display answer to user])
    
    ShowError --> ReadyUI
    
    style Start fill:#e1f5ff
    style End fill:#d4edda
    style Retrieve fill:#fff3cd
    style Generate fill:#fff3cd
    style LLMGenerate fill:#f8d7da
    style UpdateUI fill:#d1ecf1
```

## Component Flow

### 1. Frontend Components

```mermaid
sequenceDiagram
    participant User
    participant QAInterface
    participant NextJS API
    participant Backend API
    participant MongoDB
    participant Pipeline
    
    User->>QAInterface: Open QA Interface
    QAInterface->>QAInterface: Load from localStorage
    QAInterface->>NextJS API: POST /api/chat/sessions
    NextJS API->>Backend API: POST /api/chat/sessions
    Backend API->>MongoDB: Create new session
    MongoDB-->>Backend API: session_id
    Backend API-->>NextJS API: session_id
    NextJS API-->>QAInterface: session_id
    QAInterface->>QAInterface: Save session_id to localStorage
    
    loop Every 2 seconds
        QAInterface->>NextJS API: GET /api/qa/status
        NextJS API->>Backend API: GET /api/pdf/status
        Backend API-->>NextJS API: {ready, building, percent}
        NextJS API-->>QAInterface: Pipeline status
        alt Pipeline not ready
            QAInterface->>QAInterface: Show progress bar
        else Pipeline ready
            QAInterface->>QAInterface: Allow question input
        end
    end
    
    User->>QAInterface: Enter question and click Ask
    QAInterface->>NextJS API: POST /api/chat/ask
    NextJS API->>Backend API: POST /api/chat/ask
    
    Backend API->>MongoDB: Get chat history
    MongoDB-->>Backend API: chat_history[]
    
    Backend API->>Pipeline: pipeline.answer(question, chat_history)
    Pipeline->>Pipeline: Hybrid Retrieval
    Pipeline->>Pipeline: LLM Generation
    Pipeline-->>Backend API: {answer, cited_sections, confidence}
    
    Backend API->>MongoDB: Save user message
    Backend API->>MongoDB: Save assistant message
    MongoDB-->>Backend API: Success
    
    Backend API-->>NextJS API: {answer, cited_sections, confidence}
    NextJS API-->>QAInterface: Response
    QAInterface->>QAInterface: Save to localStorage
    QAInterface->>User: Display answer with citations
```

## Data Flow

### Request Flow

```
User Input
    ↓
QAInterface Component
    ↓
POST /api/chat/ask (Next.js API Route)
    ↓
POST /api/chat/ask (Backend FastAPI)
    ↓
ChatService.get_history(session_id)
    ↓
QAPipeline.answer(question, chat_history)
    ↓
Retriever.retrieve() → Generator.generate()
    ↓
Response
```

### Response Flow

```
QAPipeline Result
    ↓
{answer, cited_sections, confidence}
    ↓
ChatService.add_message() → MongoDB
    ↓
Backend API Response
    ↓
Next.js API Response
    ↓
QAInterface Update State
    ↓
localStorage Persistence
    ↓
UI Display
```

## Key Components

### 1. Frontend: `QAInterface` Component
- **Location**: `components/qa-interface.tsx`
- **Responsibilities**:
  - Session management (create/verify/restore)
  - Polling pipeline status
  - Send questions and receive answers
  - Display Q&A history
  - Local storage (localStorage)

### 2. Frontend API: `/api/chat/ask`
- **Location**: `app/api/chat/ask/route.ts`
- **Responsibilities**:
  - Proxy request to backend
  - Map response format
  - Error handling

### 3. Frontend API: `/api/chat/sessions`
- **Location**: `app/api/chat/sessions/route.ts`
- **Responsibilities**:
  - Create new session
  - Get session info
  - Proxy to backend

### 4. Frontend API: `/api/qa/status`
- **Location**: `app/api/qa/status/route.ts`
- **Responsibilities**:
  - Check pipeline readiness
  - Proxy to backend `/api/pdf/status`

### 5. Backend API: `/api/chat/ask`
- **Location**: `backend/src/paperreader/api/chat_routes.py`
- **Responsibilities**:
  - Receive question and session_id
  - Get chat history from MongoDB
  - Call QA Pipeline
  - Save messages to MongoDB
  - Return answer with citations

### 6. Backend: QA Pipeline
- **Location**: `backend/src/paperreader/services/qa/pipeline.py`
- **Components**:
  - **Retriever**: Hybrid retrieval (dense + sparse + rerank)
  - **Generator**: LLM-based answer generation
  - **Citation Extraction**: Parse [cN] markers and map with chunks

### 7. Backend: Retrieval System
- **Location**: `backend/src/paperreader/services/qa/retrievers.py`
- **Methods**:
  - Dense retrieval: Vector similarity search
  - Sparse retrieval: BM25 keyword search
  - Hybrid: Fusion of both
  - Reranking: Cross-encoder to rerank results

### 8. Backend: Generator
- **Location**: `backend/src/paperreader/services/qa/generators.py`
- **Types**:
  - OpenAI GPT-4: Primary generator
  - ExtractiveGenerator: Fallback

## State Management

### Frontend State (QAInterface)
```typescript
- sessionId: string | null
- messages: QAMessage[]
- isLoading: boolean
- isPipelineReady: boolean | null
- pipelineStatus: { building, ready, chunks, percent, stage }
- question: string
- showHistory: boolean
```

### Backend State
```python
- Pipeline cache: Keyed by PDF hash
- Vector store: In-memory embeddings
- MongoDB: Chat sessions and messages
```

## Error Handling

### Frontend
- Session initialization errors → Toast notification
- Pipeline not ready → Block input, show progress
- API errors → Error toast with retry option
- localStorage errors → Log warning, continue

### Backend
- Pipeline errors → Fallback to ExtractiveGenerator
- MongoDB errors → HTTP 503 Service Unavailable
- Timeout errors → HTTP 504 Gateway Timeout
- Validation errors → HTTP 400 Bad Request

## Performance Optimizations

1. **Pipeline Caching**: Pipeline is cached by PDF hash, only rebuilds when PDF changes
2. **localStorage Caching**: Messages are cached locally for instant restore
3. **Session Persistence**: Sessions are stored in MongoDB and localStorage
4. **Async Processing**: Pipeline.answer() runs asynchronously
5. **Polling Optimization**: Pipeline status is polled every 2 seconds, stops when ready

## Citation System

### Citation Format
- Answer text contains markers: `[c1]`, `[c2]`, ...
- Citations are extracted using regex: `\[c(\d+)\]`
- Each citation maps to a retrieved chunk
- Cited sections include:
  - `citation_number`: Citation sequence number
  - `doc_id`: Document ID
  - `title`: Section title
  - `page`: Page number
  - `excerpt`: Cited text excerpt

## Chat History

### Format
```python
[
  {
    "role": "user",
    "content": "What is the main finding?",
    "timestamp": "2024-01-01T00:00:00Z",
    "metadata": {}
  },
  {
    "role": "assistant",
    "content": "The main finding is...",
    "timestamp": "2024-01-01T00:00:01Z",
    "metadata": {
      "cited_sections": [...],
      "confidence": 0.89
    }
  }
]
```

### Usage
- Chat history is passed to generator for context-aware generation
- History is stored in MongoDB by session_id
- Frontend restores history from localStorage and backend



