import { MessagesService } from 'core/services/messages.services';
import { MessagesController } from './messages.controllers';
import { VideosController } from './videos.controllers';
import { VideosServices } from '../../core/services/videos.services';

const messagesController = new MessagesController(new MessagesService());
const videosController = new VideosController(new VideosServices());

export {
  messagesController,
  videosController
}