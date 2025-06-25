# Use an official Node.js runtime as a parent image
FROM node:18-slim

# Install system dependencies required for PDF processing with OCR
RUN apt-get update && apt-get install -y \
    imagemagick \
    ghostscript \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to leverage Docker cache
COPY package*.json ./

# Install app dependencies
# Use --omit=dev to avoid installing devDependencies in production
RUN npm install --omit=dev

# Bundle app source
COPY . .

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Define the command to run your app
CMD ["npm", "start"]
