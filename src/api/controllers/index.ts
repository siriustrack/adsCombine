import { ImagesController } from './images.controllers';
import { MessagesController } from './messages.controllers';
import { TranscribeController } from './transcribe.controllers';
import { VideosController } from './videos.controllers';

const messagesController = new MessagesController();
const videosController = new VideosController();
const imagesController = new ImagesController();
const transcribeController = new TranscribeController();

export { messagesController, videosController, imagesController, transcribeController };
