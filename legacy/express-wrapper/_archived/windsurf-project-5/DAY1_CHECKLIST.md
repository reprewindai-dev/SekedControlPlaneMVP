# Day 1 Checklist - Project Setup

**Date**: Day 1  
**Objective**: Development environment ready  

---

## ✅ Pre-Setup Requirements

### Tools Installed
- [ ] Node.js 18+ 
- [ ] Docker Desktop
- [ ] Git
- [ ] VS Code (or preferred IDE)
- [ ] PostgreSQL client (optional)

### Accounts Ready
- [ ] GitHub/GitLab (for code hosting)
- [ ] Railway (for staging deployment)
- [ ] AWS/GCP account (for future production)

---

## 📋 Day 1 Tasks

### 1. Create Monorepo Structure
```bash
# Create main project directory
mkdir seked-control-plane
cd seked-control-plane

# Initialize git
git init

# Create monorepo structure
mkdir -p services/gateway
mkdir -p services/convergeos  
mkdir -p services/seked
mkdir -p services/ecobe
mkdir -p shared/types
mkdir -p shared/utils
mkdir -p docs
mkdir -p scripts

# Create root package.json
npm init -y
```

### 2. Initialize Gateway Service
```bash
cd services/gateway
npm init -y

# Install dependencies
npm install fastify @fastify/cors @fastify/helmet
npm install prisma @prisma/client
npm install redis ioredis
npm install bcrypt jsonwebtoken
npm install ajv
npm install uuid

# Install dev dependencies  
npm install -D typescript @types/node @types/bcrypt @types/jsonwebtoken @types/uuid
npm install -D ts-node nodemon
npm install -D jest @types/jest supertest @types/supertest
```

### 3. Set Up PostgreSQL (Docker)
```bash
# Create docker-compose.yml
cat > docker-compose.yml << 'EOF'
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: seked_mvp
      POSTGRES_USER: seked
      POSTGRES_PASSWORD: seked_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
volumes:
  postgres_data:
EOF

# Start services
docker-compose up -d
```

### 4. Configure Prisma
```bash
cd services/gateway
npx prisma init --datasource-provider postgresql

# Update .env
cat > .env << 'EOF'
DATABASE_URL="postgresql://seked:seked_password@localhost:5432/seked_mvp"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="your_jwt_secret_change_in_production"
NODE_ENV="development"
PORT=3000
EOF

# Copy MVP schema
cp ../../MVP_SCHEMA.prisma prisma/schema.prisma

# Generate client
npx prisma generate

# Run migration
npx prisma migrate dev --name init
```

### 5. Create Gateway Service Skeleton
```bash
# Create TypeScript config
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
EOF

# Create source structure
mkdir -p src/routes
mkdir -p src/middleware
mkdir -p src/services
mkdir -p src/types

# Create basic app.ts
cat > src/app.ts << 'EOF'
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';

const app = Fastify({
  logger: true
});

// Register plugins
app.register(cors);
app.register(helmet);

// Health check
app.get('/health', async () => {
  return { status: 'healthy', timestamp: new Date().toISOString() };
});

// Start server
const start = async () => {
  try {
    await app.listen({ port: parseInt(process.env.PORT || '3000') });
    app.log.info(`Server listening on port ${process.env.PORT || '3000'}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
EOF

# Update package.json scripts
cat > package.json << 'EOF'
{
  "name": "seked-gateway",
  "version": "1.0.0",
  "description": "Seked Control Plane Gateway API",
  "main": "dist/app.js",
  "scripts": {
    "dev": "nodemon src/app.ts",
    "build": "tsc",
    "start": "node dist/app.js",
    "test": "jest"
  },
  "dependencies": {
    "@fastify/cors": "^8.4.0",
    "@fastify/helmet": "^11.1.1",
    "ajv": "^8.12.0",
    "bcrypt": "^5.1.1",
    "fastify": "^4.24.3",
    "ioredis": "^5.3.2",
    "jsonwebtoken": "^9.0.2",
    "prisma": "^5.6.0",
    "@prisma/client": "^5.6.0",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "@types/bcrypt": "^5.0.2",
    "@types/jest": "^29.5.8",
    "@types/jsonwebtoken": "^9.0.5",
    "@types/node": "^20.9.0",
    "@types/supertest": "^2.0.16",
    "@types/uuid": "^9.0.7",
    "jest": "^29.7.0",
    "nodemon": "^3.0.2",
    "supertest": "^6.3.3",
    "ts-node": "^10.9.1",
    "typescript": "^5.2.2"
  }
}
EOF
```

### 6. Seed Test Data
```bash
# Create seed script
cat > scripts/seed.ts << 'EOF'
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function seed() {
  console.log('Seeding database...');

  // Create test organization
  const org = await prisma.org.create({
    data: {
      name: 'Test Organization',
      plan: 'tier2'
    }
  });

  // Create test project
  const project = await prisma.project.create({
    data: {
      orgId: org.id,
      name: 'Test Project',
      environment: 'dev'
    }
  });

  // Create API key
  const apiKey = 'test_api_key_12345';
  const hashedKey = await bcrypt.hash(apiKey, 10);

  await prisma.apiKey.create({
    data: {
      orgId: org.id,
      name: 'Test API Key',
      hashedKey: hashedKey,
      role: 'admin'
    }
  });

  // Create test policy
  await prisma.policyProfile.create({
    data: {
      orgId: org.id,
      name: 'Default Policy',
      config: {
        seked: {
          escalation_thresholds: {
            tier0: 0.25,
            tier1: 0.55,
            tier2: 1.0
          }
        },
        converge: {
          max_attempts: 3,
          quality_threshold: 0.8
        },
        ecobe: {
          carbon_mode: 'balance',
          weights: {
            carbon: 0.5,
            latency: 0.3,
            cost: 0.2
          }
        }
      },
      status: 'approved',
      version: 1
    }
  });

  console.log('API Key for testing:', apiKey);
  console.log('Organization ID:', org.id);
  console.log('Project ID:', project.id);
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
EOF

# Run seed
npx ts-node scripts/seed.ts
```

### 7. Basic Testing
```bash
# Test health endpoint
curl http://localhost:3000/health

# Should return:
# {"status":"healthy","timestamp":"2026-02-18T..."}
```

---

## ✅ Day 1 Success Criteria

### Must Have:
- [ ] Monorepo structure created
- [ ] Gateway service running on port 3000
- [ ] PostgreSQL running on port 5432
- [ ] Redis running on port 6379
- [ ] Prisma schema initialized
- [ ] Health endpoint responding
- [ ] Test data seeded

### Should Have:
- [ ] TypeScript configuration
- [ ] Basic error handling
- [ ] Logging configured
- [ ] Environment variables set

### Nice to Have:
- [ ] Git repository initialized
- [ ] Docker compose working
- [ ] Basic test suite setup
- [ ] VS Code workspace configured

---

## 🚀 Next Steps (Day 2 Preview)

### Database + Auth
- [ ] Implement API key authentication middleware
- [ ] Create auth service
- [ ] Add request validation
- [ ] Create error handling middleware

### Verification Commands
```bash
# Check services are running
docker-compose ps

# Check database connection
npx prisma db pull

# Test API
curl http://localhost:3000/health

# Check Redis
redis-cli ping
```

---

## 📝 Notes

### Important:
- Keep API key secure: `test_api_key_12345`
- Database password: `seked_password`
- Default organization: "Test Organization"

### Troubleshooting:
- If PostgreSQL fails: Check Docker is running
- If port conflicts: Change ports in docker-compose.yml
- If Prisma fails: Check DATABASE_URL in .env

### Security Notes:
- Change JWT_SECRET in production
- Use environment variables for secrets
- Don't commit .env file to git

---

## ✅ Day 1 Complete When:

You can run:
```bash
curl http://localhost:3000/health
```

And get:
```json
{"status":"healthy","timestamp":"2026-02-18T..."}
```

With all services running and test data ready for Day 2.
