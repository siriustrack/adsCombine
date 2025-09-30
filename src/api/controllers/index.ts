import { ImagesController } from './images.controllers';
import { EditaisController } from './editais.controllers';
import { MessagesController } from './messages.controllers';
import { VideosController } from './videos.controllers';

const messagesController = new MessagesController();
const videosController = new VideosController();
const imagesController = new ImagesController();
const editaisController = new EditaisController();

export { messagesController, videosController, imagesController, editaisController };
