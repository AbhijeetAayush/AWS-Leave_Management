# Leave Management Application 

Here’s a well-structured **GitHub README** file for your project, including a visually appealing format, API endpoints, request/response details, and setup instructions.  

---

### **📌 Leave Management System (AWS Lambda + DynamoDB + SES)**
A serverless **Leave Management System** built using AWS Lambda, DynamoDB, and SES. It allows employees to apply for leave, and managers to approve or reject leave requests via email notifications.

---

## 🚀 **Tech Stack**
- **Backend:** AWS Lambda (Node.js + TypeScript)
- **Database:** Amazon DynamoDB
- **Email Service:** AWS SES (Simple Email Service)
- **API Gateway:** RESTful API

---

## 🛠 **Installation & Setup**
### **1️⃣ Clone the Repository**
```sh[
git clone https://github.com/AbhijeetAayush/AWS-Leave_Management.git
cd leave-management-system
```

### **2️⃣ Install Dependencies**
```sh
npm install
```

### **3️⃣ Set Up AWS Credentials**
Ensure your AWS CLI is configured with necessary permissions:
```sh
aws configure
```

### **4️⃣ Deploy to AWS**
Modify `.env` file:
```plaintext
TABLE_NAME=your-dynamodb-table
SES_EMAIL=your-verified-email@example.com
```
Then deploy:
```sh
serverless deploy
```

---

## 📡 **API Endpoints**
| **Endpoint**          | **Method** | **Description**            | **Request Body** (JSON) | **Response** |
|----------------------|----------|----------------------------|------------------|------------|
| `/apply-leave`      | `POST`   | Apply for leave            | `{ userEmail, leaveType, startDate, endDate, reason }` | `{ message, requestId }` |
| `/approve-leave`    | `PUT`    | Approve or reject a request | `{ requestId, approved }` | `{ message }` |

---

## 📌 **API Details**
### **1️⃣ Apply for Leave**
**Endpoint:**  
```http
POST /apply-leave
```
**Request Body:**
```json
{
  "userEmail": "john@example.com",
  "leaveType": "Sick Leave",
  "startDate": "2025-04-01",
  "endDate": "2025-04-05",
  "reason": "Medical emergency"
}
```
**Response:**
```json
{
  "message": "Leave applied",
  "requestId": "LEAVE-1710000000000"
}
```

---

### **2️⃣ Approve Leave**
**Endpoint:**  
```http
PUT /approve-leave
```
**Request Body:**
```json
{
  "requestId": "LEAVE-1710000000000",
  "approved": true
}
```
**Response:**
```json
{
  "message": "Leave status updated"
}
```

---

## 📧 **Email Notification Workflow**
✔ **Employee applies for leave → Manager receives an approval email via AWS SES**  
✔ **Manager approves/rejects the request → Employee receives a notification email**  

---

## 📌 **Project Structure**
```
📂 leave-management-system
 ├── 📂 hello-world
 │   ├── 📄 app.ts       # Lambda functions
 │  
 │   
 ├── 📄 template.yml             # Deployment Configuration
 ├── 📄 step-function.asl.json   
 ├── 📄 package.json         # Dependencies
 ├── 📄 README.md            # Project Documentation
```

---

## ⚡ **To-Do / Future Enhancements**
- ✅ Implement **Leave Cancellation**
- ✅ Add **User Authentication (Cognito)**
- ✅ Enable **Admin Dashboard for leave tracking**

---

## 🤝 **Contributing**
Feel free to fork the repository, create a new branch, and submit a pull request!  

---

## 🌟 **Show Some Love**
If you found this project helpful, **give it a ⭐ on GitHub!** 😊🚀

---

Let me know if you need any modifications! 🚀
