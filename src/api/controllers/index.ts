import { MessagesController } from './messages.controllers';
import { TranscribeController } from './transcribe.controllers';

const messagesController = new MessagesController();
const transcribeController = new TranscribeController();

export { messagesController, transcribeController };
