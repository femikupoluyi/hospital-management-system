# Hospital Management System (HMS)

## 🏥 Overview
A comprehensive, modular Hospital Management System with full functionality for managing hospital operations, including patient management, medical records, billing, inventory, staff scheduling, and analytics.

## ✨ Features

### 1. **Electronic Medical Records (EMR)**
- Patient registration and management
- Medical history tracking
- Diagnosis and treatment plans
- Prescription management
- Lab results integration
- Document attachments

### 2. **Billing & Revenue Management**
- Invoice generation
- Payment processing
- Insurance claims handling
- Support for multiple payment methods (Cash, Card, Insurance, NHIS)
- Revenue tracking and reports

### 3. **Inventory Management**
- Medicine and supplies tracking
- Automatic reorder alerts
- Batch and expiry date management
- Supplier management
- Stock movement tracking

### 4. **Staff Management**
- Staff scheduling and rostering
- Shift management
- Department-wise allocation
- Attendance tracking
- Performance metrics

### 5. **Bed Management**
- Real-time bed availability
- Admission and discharge processing
- Ward-wise occupancy tracking
- Patient transfer management

### 6. **Analytics Dashboard**
- Real-time operational metrics
- Revenue analytics
- Occupancy trends
- Performance KPIs
- Export reports (PDF/Excel)

## 🚀 Quick Start

### Prerequisites
- Node.js (v14 or higher)
- PostgreSQL database (we use Neon)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/hospital-management-system.git
cd hospital-management-system
```

2. Install dependencies:
```bash
npm install
```

3. Update database connection in `hms-backend-full.js`:
```javascript
const DATABASE_URL = 'your_postgresql_connection_string';
```

4. Start the backend server:
```bash
node hms-backend-full.js
# Server runs on http://localhost:4000
```

5. Start the frontend server:
```bash
node hms-frontend-server.js
# Frontend runs on http://localhost:4001
```

## 📝 API Documentation

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user

### Patients
- `GET /api/patients` - Get all patients
- `POST /api/patients` - Create new patient
- `GET /api/patients/:id` - Get patient by ID
- `PUT /api/patients/:id` - Update patient

### Medical Records
- `POST /api/medical-records` - Create medical record
- `GET /api/medical-records/patient/:patientId` - Get patient records

### Billing
- `POST /api/invoices` - Create invoice
- `GET /api/invoices` - Get all invoices
- `POST /api/invoices/:id/payment` - Process payment
- `GET /api/invoices/:id/pdf` - Generate PDF invoice

### Inventory
- `POST /api/inventory` - Add inventory item
- `GET /api/inventory` - Get all items
- `GET /api/inventory/low-stock` - Get low stock alerts

### Staff
- `POST /api/staff-schedules` - Create schedule
- `GET /api/staff-schedules` - Get schedules
- `GET /api/staff-roster` - Get staff roster

### Beds
- `GET /api/beds` - Get all beds
- `GET /api/beds/available` - Get available beds
- `POST /api/beds/admit` - Admit patient
- `POST /api/beds/:id/discharge` - Discharge patient

### Analytics
- `GET /api/analytics/dashboard` - Get dashboard stats
- `GET /api/analytics/revenue` - Get revenue analytics
- `GET /api/analytics/occupancy` - Get occupancy analytics

## 🧪 Testing

Run the test suite:
```bash
node test-hms-full.js
```

## 🔒 Security Features
- JWT-based authentication
- Role-based access control (RBAC)
- Password encryption with bcrypt
- SQL injection prevention
- CORS protection
- Input validation

## 📊 Database Schema

The system uses PostgreSQL with the following main tables:
- `hms.users` - System users
- `hms.patients` - Patient information
- `hms.medical_records` - Medical records
- `hms.invoices` - Billing information
- `hms.inventory` - Stock management
- `hms.staff_schedules` - Staff scheduling
- `hms.beds` - Bed management
- `hms.appointments` - Appointment scheduling
- `hms.lab_results` - Laboratory results
- `hms.prescriptions` - Prescription management

## 🌐 Deployment

### Using PM2
```bash
# Install PM2 globally
npm install -g pm2

# Start backend
pm2 start hms-backend-full.js --name hms-backend

# Start frontend
pm2 start hms-frontend-server.js --name hms-frontend

# Save PM2 configuration
pm2 save
pm2 startup
```

### Environment Variables
Create a `.env` file:
```
DATABASE_URL=your_database_url
JWT_SECRET=your_jwt_secret
PORT=4000
FRONTEND_PORT=4001
```

## 📱 Default Credentials

After seeding initial data:
- **Admin**: admin@hospital.com / password123
- **Doctor**: dr.smith@hospital.com / password123
- **Nurse**: nurse.jane@hospital.com / password123
- **Technician**: tech.john@hospital.com / password123

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For support, please create an issue in the GitHub repository.

## 🙏 Acknowledgments

- Built with Express.js and PostgreSQL
- UI styled with modern CSS
- Real-time updates with WebSockets (planned)
- PDF generation with PDFKit

---
**Version**: 2.0.0
**Last Updated**: October 2025
