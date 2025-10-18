/**
 * @fileoverview Componente React para Upload e Processamento de Editais
 * @author Paulo Chaves
 * @date 2025-10-14
 * 
 * Componente completo e pronto para uso que gerencia todo o fluxo de upload e processamento.
 */

import React, { useState, useCallback } from 'react';
import { 
  EditalProcessClient, 
  EditalProcessado, 
  EditalApiError,
  EditalValidationError,
  EditalTimeoutError,
  createEditalClient 
} from './FRONTEND-EDITAL-CLIENT';

// ============================================================================
// TYPES
// ============================================================================

interface EditalUploadProps {
  /** UUID do usuário logado */
  userId: string;
  /** UUID do plano de estudos ativo */
  schedulePlanId: string;
  /** Base URL da API */
  apiBaseUrl?: string;
  /** Token de autenticação */
  authToken?: string;
  /** Callback quando o processamento for concluído */
  onComplete?: (data: EditalProcessado) => void;
  /** Callback quando houver erro */
  onError?: (error: Error) => void;
}

type UploadStatus = 
  | 'idle'
  | 'uploading'
  | 'transcribing'
  | 'processing'
  | 'completed'
  | 'error';

interface StatusState {
  status: UploadStatus;
  progress: number;
  message: string;
  jobId?: string;
  filePath?: string;
  data?: EditalProcessado;
  error?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function EditalUpload({
  userId,
  schedulePlanId,
  apiBaseUrl = 'http://localhost:3000',
  authToken,
  onComplete,
  onError,
}: EditalUploadProps) {
  const [state, setState] = useState<StatusState>({
    status: 'idle',
    progress: 0,
    message: 'Pronto para upload',
  });

  const updateStatus = useCallback((updates: Partial<StatusState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  const handleFileUpload = useCallback(
    async (file: File) => {
      try {
        // Reset state
        setState({
          status: 'uploading',
          progress: 10,
          message: `Fazendo upload de ${file.name}...`,
        });

        // 1. Upload para serviço de transcrição
        const transcriptionUrl = await uploadToTranscriptionService(file, (progress) => {
          updateStatus({
            status: 'transcribing',
            progress: 10 + progress * 0.2, // 10% -> 30%
            message: `Transcrevendo arquivo... ${Math.round(progress)}%`,
          });
        });

        // 2. Processar edital com a API
        updateStatus({
          status: 'processing',
          progress: 30,
          message: 'Iniciando processamento com IA...',
        });

        const client = createEditalClient(apiBaseUrl, authToken);

        const result = await client.processEdital(
          {
            user_id: userId,
            schedule_plan_id: schedulePlanId,
            url: transcriptionUrl,
          },
          (stage, data) => {
            if (stage === 'starting') {
              updateStatus({
                progress: 40,
                message: 'Conectando com Claude Sonnet 4.5...',
              });
            } else if (stage === 'polling') {
              const pollData = data as { attempt?: number; maxAttempts?: number; jobId?: string };
              
              if (pollData.jobId) {
                updateStatus({
                  jobId: pollData.jobId,
                });
              }

              if (pollData.attempt && pollData.maxAttempts) {
                const pollingProgress = (pollData.attempt / pollData.maxAttempts) * 60;
                updateStatus({
                  progress: 40 + pollingProgress,
                  message: `Processando com IA... ${Math.round(pollingProgress + 40)}%`,
                });
              }
            }
          }
        );

        // 3. Sucesso!
        updateStatus({
          status: 'completed',
          progress: 100,
          message: '✅ Edital processado com sucesso!',
          data: result,
        });

        if (onComplete) {
          onComplete(result);
        }
      } catch (error) {
        console.error('Erro no processamento:', error);

        let errorMessage = 'Erro desconhecido';

        if (error instanceof EditalValidationError) {
          errorMessage = `Erro de validação: ${error.message}`;
          console.error('Detalhes da validação:', error.validationDetails);
        } else if (error instanceof EditalTimeoutError) {
          errorMessage = 'Timeout: O processamento levou muito tempo. Tente novamente.';
        } else if (error instanceof EditalApiError) {
          errorMessage = `Erro na API: ${error.message} (${error.statusCode})`;
        } else if (error instanceof Error) {
          errorMessage = error.message;
        }

        updateStatus({
          status: 'error',
          progress: 0,
          message: errorMessage,
          error: errorMessage,
        });

        if (onError && error instanceof Error) {
          onError(error);
        }
      }
    },
    [userId, schedulePlanId, apiBaseUrl, authToken, onComplete, onError, updateStatus]
  );

  const handleReset = useCallback(() => {
    setState({
      status: 'idle',
      progress: 0,
      message: 'Pronto para upload',
    });
  }, []);

  // Render
  return (
    <div className="edital-upload-container">
      <div className="upload-header">
        <h2>📄 Processar Edital</h2>
        <p className="upload-description">
          Faça upload de um PDF ou vídeo do edital para processamento automático com IA
        </p>
      </div>

      {state.status === 'idle' && (
        <div className="upload-area">
          <input
            type="file"
            id="edital-file"
            accept=".pdf,.mp4,.mov,.avi"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
            }}
            style={{ display: 'none' }}
          />
          <label htmlFor="edital-file" className="upload-button">
            <span className="upload-icon">📤</span>
            <span>Selecionar Arquivo</span>
            <span className="upload-hint">PDF, MP4, MOV ou AVI</span>
          </label>
        </div>
      )}

      {state.status !== 'idle' && (
        <div className="status-container">
          <div className="progress-section">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${state.progress}%` }}
              />
            </div>
            <p className="progress-text">{Math.round(state.progress)}%</p>
          </div>

          <div className="status-message">
            <StatusIcon status={state.status} />
            <p>{state.message}</p>
          </div>

          {state.jobId && (
            <div className="job-info">
              <span className="label">Job ID:</span>
              <code className="job-id">{state.jobId}</code>
            </div>
          )}

          {state.status === 'completed' && state.data && (
            <div className="results-container">
              <h3>📊 Resultados do Processamento</h3>
              <ResultsSummary data={state.data} />
              <button 
                onClick={handleReset}
                className="button-reset"
              >
                Processar Novo Edital
              </button>
            </div>
          )}

          {state.status === 'error' && (
            <div className="error-container">
              <p className="error-message">{state.error}</p>
              <button 
                onClick={handleReset}
                className="button-retry"
              >
                Tentar Novamente
              </button>
            </div>
          )}

          {state.status === 'processing' && (
            <div className="processing-info">
              <p className="info-text">
                ⏱️ Tempo estimado: 1-4 minutos
              </p>
              <p className="info-text">
                🤖 Processando com Claude Sonnet 4.5
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function StatusIcon({ status }: { status: UploadStatus }) {
  const icons: Record<UploadStatus, string> = {
    idle: '📄',
    uploading: '📤',
    transcribing: '📝',
    processing: '⚙️',
    completed: '✅',
    error: '❌',
  };

  return <span className="status-icon">{icons[status]}</span>;
}

function ResultsSummary({ data }: { data: EditalProcessado }) {
  const totalDisciplinas = data.concursos.reduce(
    (sum, c) => sum + c.disciplinas.length,
    0
  );

  const totalTopicos = data.concursos.reduce(
    (sum, c) => sum + c.disciplinas.reduce((s, d) => s + d.topicos.length, 0),
    0
  );

  return (
    <div className="results-summary">
      <div className="stat">
        <span className="stat-label">Concursos:</span>
        <span className="stat-value">{data.concursos.length}</span>
      </div>
      <div className="stat">
        <span className="stat-label">Disciplinas:</span>
        <span className="stat-value">{totalDisciplinas}</span>
      </div>
      <div className="stat">
        <span className="stat-label">Tópicos:</span>
        <span className="stat-value">{totalTopicos}</span>
      </div>

      <div className="concursos-list">
        {data.concursos.map((concurso) => (
          <div key={concurso.id} className="concurso-card">
            <h4>{concurso.titulo}</h4>
            <p className="concurso-info">
              <strong>Órgão:</strong> {concurso.orgao}
            </p>
            <p className="concurso-info">
              <strong>Cargo:</strong> {concurso.cargo}
            </p>
            <p className="concurso-info">
              <strong>Data da Prova:</strong> {new Date(concurso.dataProva).toLocaleDateString('pt-BR')}
            </p>
            <p className="concurso-info">
              <strong>Tipo:</strong> {concurso.tipoProva} | <strong>Turno:</strong> {concurso.turno}
            </p>
            <p className="concurso-info">
              <strong>Disciplinas:</strong> {concurso.disciplinas.length}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Simula upload para serviço de transcrição
 * Em produção, substituir pela chamada real ao seu serviço
 */
async function uploadToTranscriptionService(
  file: File,
  onProgress: (progress: number) => void
): Promise<string> {
  // Simula upload com progresso
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const progress = (event.loaded / event.total) * 100;
        onProgress(progress);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          resolve(response.url || response.transcriptionUrl);
        } catch (error) {
          reject(new Error('Invalid response from transcription service'));
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload'));
    });

    xhr.open('POST', 'http://your-transcription-service.com/upload');
    // Adicione headers necessários, como Authorization
    xhr.send(formData);
  });
}

// ============================================================================
// CSS STYLES (opcional - pode ser movido para arquivo .css separado)
// ============================================================================

export const editalUploadStyles = `
.edital-upload-container {
  max-width: 800px;
  margin: 0 auto;
  padding: 24px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
}

.upload-header {
  text-align: center;
  margin-bottom: 32px;
}

.upload-header h2 {
  font-size: 28px;
  margin-bottom: 8px;
  color: #1a1a1a;
}

.upload-description {
  font-size: 14px;
  color: #666;
}

.upload-area {
  display: flex;
  justify-content: center;
  padding: 48px 24px;
  border: 2px dashed #ddd;
  border-radius: 12px;
  background: #fafafa;
}

.upload-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px 48px;
  background: #007bff;
  color: white;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.upload-button:hover {
  background: #0056b3;
  transform: translateY(-2px);
}

.upload-icon {
  font-size: 48px;
}

.upload-hint {
  font-size: 12px;
  opacity: 0.8;
}

.status-container {
  padding: 24px;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  background: white;
}

.progress-section {
  margin-bottom: 24px;
}

.progress-bar {
  width: 100%;
  height: 12px;
  background: #e0e0e0;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 8px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #007bff, #0056b3);
  transition: width 0.3s ease;
}

.progress-text {
  text-align: right;
  font-size: 14px;
  font-weight: 600;
  color: #007bff;
}

.status-message {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.status-icon {
  font-size: 24px;
}

.job-info {
  padding: 12px;
  background: #f5f5f5;
  border-radius: 8px;
  margin-bottom: 16px;
}

.job-info .label {
  font-weight: 600;
  margin-right: 8px;
}

.job-id {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #666;
}

.results-container {
  margin-top: 24px;
}

.results-container h3 {
  margin-bottom: 16px;
}

.results-summary {
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
}

.stat {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #e0e0e0;
}

.stat:last-of-type {
  border-bottom: none;
}

.stat-label {
  font-weight: 600;
}

.stat-value {
  color: #007bff;
  font-weight: 700;
}

.concursos-list {
  margin-top: 16px;
}

.concurso-card {
  padding: 16px;
  margin-bottom: 12px;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}

.concurso-card h4 {
  margin-bottom: 12px;
  color: #1a1a1a;
}

.concurso-info {
  font-size: 14px;
  margin: 4px 0;
  color: #666;
}

.error-container {
  padding: 16px;
  background: #fee;
  border: 1px solid #fcc;
  border-radius: 8px;
  margin-top: 16px;
}

.error-message {
  color: #c00;
  margin-bottom: 12px;
}

.processing-info {
  margin-top: 16px;
  padding: 12px;
  background: #e3f2fd;
  border-radius: 8px;
}

.info-text {
  margin: 4px 0;
  font-size: 14px;
  color: #1976d2;
}

.button-reset,
.button-retry {
  width: 100%;
  padding: 12px;
  margin-top: 16px;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.button-reset:hover,
.button-retry:hover {
  background: #0056b3;
}

.button-retry {
  background: #dc3545;
}

.button-retry:hover {
  background: #c82333;
}
`;

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

/**
 * Exemplo de uso do componente
 */
export function App() {
  const handleComplete = (data: EditalProcessado) => {
    console.log('✅ Edital processado com sucesso:', data);
    // Aqui você pode salvar no estado global, navegar para outra página, etc.
  };

  const handleError = (error: Error) => {
    console.error('❌ Erro ao processar edital:', error);
    // Aqui você pode mostrar notificação de erro, etc.
  };

  return (
    <div>
      <EditalUpload
        userId="98d8b11a-8a32-4f6b-9dae-6e42efa23116"
        schedulePlanId="bca596cc-d484-4df1-8cf2-e9a5ca637eac"
        apiBaseUrl="http://localhost:3000"
        authToken="your-auth-token"
        onComplete={handleComplete}
        onError={handleError}
      />
    </div>
  );
}
