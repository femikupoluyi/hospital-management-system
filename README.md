# 🏥 Hospital Management System

A comprehensive, production-ready Hospital Management System with full-stack implementation including Electronic Medical Records, Billing, Inventory, Staff Management, Bed Management, and Analytics.

## 🌟 Live Demo

- **Frontend**: https://hms-frontend-ui-morphvm-mkofwuzh.http.cloud.morph.so/hms-frontend-complete.html
- **Backend API**: https://hms-backend-api-morphvm-mkofwuzh.http.cloud.morph.so
- **API Health Check**: https://hms-backend-api-morphvm-mkofwuzh.http.cloud.morph.so/api/health

### Default Credentials
- Username: `admin`
- Password: `admin123`

## ✨ Features

### 📋 Electronic Medical Records (EMR)
- Complete patient medical history management
- Diagnoses tracking with ICD codes
- Prescription management
- Lab results with file attachments
- Vital signs recording
- Visit history and follow-ups

### 💰 Billing & Revenue Management
- Invoice generation with line items
- Multiple payment methods (Cash, Card, Insurance, Bank Transfer)
- Payment tracking and partial payments
- Insurance claim submissions
- Revenue analytics and reports
- Due date management

### 📦 Inventory Management
- Medication and supplies tracking
- Real-time stock levels
- Automatic reorder alerts
- Purchase order management
- Expiry date tracking
- Stock movement history
- Category-based organization

### 👥 Staff Management
- Employee profiles and credentials
- Shift scheduling and roster management
- Attendance tracking
- Payroll processing
- Performance metrics
- Department-wise organization

### 🛏️ Bed Management
- Real-time bed availability
- Ward occupancy tracking
- Patient admission and discharge
- Bed transfer management
- Ward-wise organization
- Cleaning status tracking

### 📊 Analytics Dashboard
- Real-time operational metrics
- Occupancy trends
- Revenue analytics
- Patient flow visualization
- Staff performance KPIs
- Exportable reports

## 🚀 Technology Stack

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL (Neon)
- **Authentication**: JWT
- **Real-time**: WebSocket
- **File Upload**: Multer
- **PDF Generation**: PDFKit

### Frontend
- **Framework**: Bootstrap 5
- **JavaScript**: Vanilla JS with ES6+
- **Real-time Updates**: WebSocket
- **Charts**: Chart.js (ready for integration)
- **Icons**: Emoji icons for modern UI

### Database Schema
- 25+ tables with proper relationships
- Foreign key constraints
- Indexes for performance
- JSON fields for flexible data
- Audit timestamps

## 📦 Installation

### Prerequisites
- Node.js 14+ 
- PostgreSQL database (or Neon account)
- npm or yarn

### Setup Steps

1. **Clone the repository**
```bash
git clone https://github.com/femikupoluyi/hospital-management-system.git
cd hospital-management-system
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure database**
Update the DATABASE_URL in `backend.js`:
```javascript
const DATABASE_URL = 'your-postgresql-connection-string';
```

4. **Start the backend**
```bash
node backend.js
# Backend runs on port 5500
```

5. **Serve the frontend**
```bash
npx http-server -p 5501
# Frontend runs on port 5501
```

6. **Access the application**
Open http://localhost:5501/index.html in your browser

## 🔑 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login

### Patients
- `GET /api/patients` - List all patients
- `GET /api/patients/:id` - Get patient details
- `POST /api/patients` - Create new patient
- `PUT /api/patients/:id` - Update patient

### Medical Records
- `GET /api/medical-records` - List all records
- `GET /api/medical-records/:id` - Get record details
- `GET /api/medical-records/patient/:patientId` - Get patient's records
- `POST /api/medical-records` - Create new record

### Billing
- `GET /api/invoices` - List all invoices
- `GET /api/invoices/:id` - Get invoice details
- `POST /api/invoices` - Create invoice
- `PUT /api/invoices/:id/payment` - Record payment
- `POST /api/insurance-claims` - Submit insurance claim
- `GET /api/revenue-reports` - Generate revenue reports

### Inventory
- `GET /api/inventory` - List all items
- `POST /api/inventory/items` - Add new item
- `PUT /api/inventory/:id/stock` - Update stock
- `GET /api/inventory/low-stock` - Get low stock alerts
- `GET /api/inventory/expiring` - Get expiring items
- `POST /api/inventory/orders` - Create purchase order

### Staff
- `GET /api/staff` - List all staff
- `POST /api/staff` - Add new staff member
- `GET /api/schedules/roster` - Get roster
- `POST /api/schedules` - Create schedule
- `POST /api/attendance` - Record attendance
- `GET /api/payroll` - Get payroll data

### Bed Management
- `GET /api/beds/available` - Get available beds
- `POST /api/admissions` - New admission
- `PUT /api/beds/:id/assign` - Assign bed
- `PUT /api/beds/:id/release` - Release bed
- `GET /api/wards/occupancy` - Ward occupancy stats
- `POST /api/transfers` - Transfer patient

### Analytics
- `GET /api/analytics/overview` - General metrics
- `GET /api/analytics/occupancy` - Occupancy trends
- `GET /api/analytics/revenue` - Revenue analytics
- `GET /api/analytics/patient-flow` - Patient flow metrics
- `GET /api/analytics/staff-performance` - Staff KPIs
- `POST /api/analytics/export` - Export reports

## 🧪 Testing

Run the included test script to verify all modules:

```bash
chmod +x test-modules.sh
./test-modules.sh
```

This will test:
- Authentication
- Patient management
- Medical records
- Billing & invoicing
- Inventory management
- Staff management
- Bed management
- Analytics
- WebSocket connections

## 📊 Database Schema

The system uses PostgreSQL with the following main tables:

- `users` - System users and authentication
- `patients` - Patient demographics and information
- `medical_records` - Patient visit records
- `diagnoses` - Medical diagnoses
- `prescriptions` - Medication prescriptions
- `lab_results` - Laboratory test results
- `invoices` - Billing invoices
- `invoice_items` - Invoice line items
- `payments` - Payment records
- `insurance_claims` - Insurance claim submissions
- `inventory_items` - Stock items
- `stock_movements` - Stock transaction history
- `purchase_orders` - Purchase orders
- `staff` - Staff information
- `schedules` - Staff schedules
- `attendance` - Attendance records
- `payroll` - Payroll records
- `wards` - Hospital wards
- `beds` - Hospital beds
- `admissions` - Patient admissions
- `bed_transfers` - Bed transfer records

## 🔒 Security Features

- JWT-based authentication
- Password hashing with bcrypt
- Role-based access control ready
- SQL injection prevention
- CORS configuration
- Input validation
- Secure file uploads
- HTTPS in production

## 📱 Responsive Design

The system is fully responsive and works on:
- Desktop computers
- Tablets
- Mobile phones
- Large displays (for nursing stations)

## 🚦 Real-time Features

- WebSocket connection for live updates
- Real-time bed availability
- Live inventory alerts
- Instant notification system
- Auto-refresh dashboards

## 🎯 Use Cases

Perfect for:
- Small to medium hospitals
- Clinics and medical centers
- Healthcare chains
- Medical practices
- Healthcare management organizations

## 📈 Performance

- Optimized database queries
- Connection pooling
- Lazy loading
- Caching ready
- Pagination support
- Indexed database fields

## 🛠️ Development

### Project Structure
```
hospital-management-system/
├── backend.js          # Express backend server
├── index.html          # Frontend application
├── test-modules.sh     # Testing script
├── package.json        # Dependencies
└── README.md          # Documentation
```

### Environment Variables
Create a `.env` file:
```env
DATABASE_URL=your_database_url
JWT_SECRET=your_jwt_secret
PORT=5500
```

## 🤝 Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Built with modern web technologies
- Designed for healthcare professionals
- Focused on usability and reliability

## 📞 Support

For issues, questions, or suggestions:
- Open an issue on GitHub
- Contact the development team
- Check the documentation

## 🔄 Updates

The system receives regular updates with:
- New features
- Security patches
- Performance improvements
- Bug fixes

## 🏆 Key Highlights

- ✅ **Production Ready** - Deployed and tested
- ✅ **Fully Functional** - All modules working
- ✅ **Real-time Updates** - WebSocket integration
- ✅ **Secure** - JWT authentication
- ✅ **Scalable** - Modular architecture
- ✅ **Modern UI** - Bootstrap 5
- ✅ **Complete CRUD** - All operations implemented
- ✅ **Analytics** - Comprehensive reporting
- ✅ **Mobile Ready** - Responsive design
- ✅ **Well Documented** - Clear code and API docs

---

**Built with ❤️ for Healthcare**
