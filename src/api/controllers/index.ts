import { JobsController } from './jobs.controllers';
import { MessagesController } from './messages.controllers';
import { TranscribeController } from './transcribe.controllers';

const jobsController = new JobsController();
const messagesController = new MessagesController();
const transcribeController = new TranscribeController();

export { jobsController, messagesController, transcribeController };
