FROM python:3.11-slim

# Install the necessary compilers and runtime environments
RUN apt-get update && apt-get install -y \
    nodejs \
    gcc \
    g++ \
    default-jdk

# Set up the Python environment
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the backend code
COPY . .

# Run the production Gunicorn server
CMD ["gunicorn", "-b", "0.0.0.0:10000", "app:app"]