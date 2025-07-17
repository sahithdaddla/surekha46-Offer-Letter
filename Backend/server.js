const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const fileUpload = require('express-fileupload');
const path = require('path');
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(fileUpload());

// PostgreSQL connection
const pool = new Pool({
    user: 'postgres',
    host: 'postgres',
    database: 'employee_portals',
    password: 'admin123',
    port: 5432,
});

// Utility to validate base64 file
function isValidBase64(base64String) {
    try {
        return base64String && /^data:[a-zA-Z0-9\/+]+;base64,[a-zA-Z0-9\/+=]+$/.test(base64String);
    } catch {
        return false;
    }
}

// Submit employee form
app.post('/api/employee/submit', async (req, res) => {
    try {
        const {
            referralId, role, position, location, name, email, phone, guardianName, guardianPhone,
            address, documents, previousEmployment, status, submissionDate
        } = req.body;

        // Validate required fields
        if (!referralId || !name || !email || !phone || !guardianName || !guardianPhone || !address || !role || !position || !location) {
            return res.status(400).json({ error: 'All required fields must be provided' });
        }

        // Validate documents
        const requiredDocs = ['ssc', 'hsc', 'ug'];
        for (const doc of requiredDocs) {
            if (!documents?.[doc]?.data || !isValidBase64(documents[doc].data)) {
                return res.status(400).json({ error: `${doc.toUpperCase()} document is invalid or missing` });
            }
        }

        // Validate previous employment if experienced
        if (previousEmployment && previousEmployment.company) {
            if (!previousEmployment.relievingLetter?.data || !isValidBase64(previousEmployment.relievingLetter.data)) {
                return res.status(400).json({ error: 'Relieving letter is required for experienced employees' });
            }
        }

        // Insert employee data
        const employeeQuery = `
            INSERT INTO employees (
                referral_id, role, position, location, name, email, phone, guardian_name, guardian_phone,
                address, status, submission_date
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id
        `;
        const employeeValues = [
            referralId, role, position, location, name, email, phone, guardianName,
            guardianPhone, address, status || 'pending', submissionDate || new Date().toISOString()
        ];
        const employeeResult = await pool.query(employeeQuery, employeeValues);
        const employeeId = employeeResult.rows[0].id;

        // Insert documents
        const docQuery = `
            INSERT INTO documents (
                employee_id, document_type, file_name, file_type, file_data, upload_date
            ) VALUES ($1, $2, $3, $4, $5, $6)
        `;
        for (const [docType, doc] of Object.entries(documents)) {
            if (doc?.data && isValidBase64(doc.data)) {
                await pool.query(docQuery, [
                    employeeId, docType, doc.name, doc.type, doc.data, doc.uploadDate || new Date().toISOString()
                ]);
            }
        }

        // Insert previous employment if applicable
        if (previousEmployment && previousEmployment.company) {
            const prevEmpQuery = `
                INSERT INTO previous_employment (
                    employee_id, company, role, experience, relieving_letter_name, relieving_letter_type,
                    relieving_letter_data, relieving_letter_upload_date
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `;
            await pool.query(prevEmpQuery, [
                employeeId,
                previousEmployment.company,
                previousEmployment.role,
                previousEmployment.experience,
                previousEmployment.relievingLetter?.name,
                previousEmployment.relievingLetter?.type,
                previousEmployment.relievingLetter?.data,
                previousEmployment.relievingLetter?.uploadDate || new Date().toISOString()
            ]);
        }

        res.status(201).json({ message: 'Employee data submitted successfully', referralId });
    } catch (error) {
        console.error('Error submitting employee data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all employees
app.get('/api/employees', async (req, res) => {
    try {
        const query = `
            SELECT e.*, 
                   pe.company, pe.role as prev_role, pe.experience as prev_experience,
                   pe.relieving_letter_name, pe.relieving_letter_type, pe.relieving_letter_data,
                   pe.relieving_letter_upload_date,
                   ol.file_name as offer_letter_name, ol.file_type as offer_letter_type,
                   ol.file_data as offer_letter_data, ol.upload_date as offer_letter_upload_date
            FROM employees e
            LEFT JOIN previous_employment pe ON e.id = pe.employee_id
            LEFT JOIN offer_letters ol ON e.id = ol.employee_id
        `;
        const result = await pool.query(query);
        const employees = result.rows.map(row => ({
            id: row.id,
            referralId: row.referral_id,
            role: row.role,
            position: row.position,
            location: row.location,
            name: row.name,
            email: row.email,
            phone: row.phone,
            guardianName: row.guardian_name,
            guardianPhone: row.guardian_phone,
            address: row.address,
            status: row.status,
            submissionDate: row.submission_date,
            approvalDate: row.approval_date,
            rejectionDate: row.rejection_date,
            rejectionReason: row.rejection_reason,
            previousEmployment: row.company ? {
                company: row.company,
                role: row.prev_role,
                experience: row.prev_experience,
                relievingLetter: row.relieving_letter_data ? {
                    name: row.relieving_letter_name,
                    type: row.relieving_letter_type,
                    data: row.relieving_letter_data,
                    uploadDate: row.relieving_letter_upload_date
                } : null
            } : null,
            offerLetter: row.offer_letter_data ? {
                name: row.offer_letter_name,
                type: row.offer_letter_type,
                data: row.offer_letter_data,
                uploadDate: row.offer_letter_upload_date
            } : null
        }));

        // Fetch documents for each employee
        for (const employee of employees) {
            const docQuery = `
                SELECT document_type, file_name, file_type, file_data, upload_date
                FROM documents
                WHERE employee_id = $1
            `;
            const docResult = await pool.query(docQuery, [employee.id]);
            employee.documents = {};
            docResult.rows.forEach(doc => {
                employee.documents[doc.document_type] = {
                    name: doc.file_name,
                    type: doc.file_type,
                    data: doc.file_data,
                    uploadDate: doc.upload_date
                };
            });
        }

        res.json(employees);
    } catch (error) {
        console.error('Error fetching employees:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get employee by ID
app.get('/api/employee/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const query = `
            SELECT e.*, 
                   pe.company, pe.role as prev_role, pe.experience as prev_experience,
                   pe.relieving_letter_name, pe.relieving_letter_type, pe.relieving_letter_data,
                   pe.relieving_letter_upload_date,
                   ol.file_name as offer_letter_name, ol.file_type as offer_letter_type,
                   ol.file_data as offer_letter_data, ol.upload_date as offer_letter_upload_date
            FROM employees e
            LEFT JOIN previous_employment pe ON e.id = pe.employee_id
            LEFT JOIN offer_letters ol ON e.id = ol.employee_id
            WHERE e.id = $1
        `;
        const result = await pool.query(query, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        const employee = result.rows[0];
        const docQuery = `
            SELECT document_type, file_name, file_type, file_data, upload_date
            FROM documents
            WHERE employee_id = $1
        `;
        const docResult = await pool.query(docQuery, [id]);
        const documents = {};
        docResult.rows.forEach(doc => {
            documents[doc.document_type] = {
                name: doc.file_name,
                type: doc.file_type,
                data: doc.file_data,
                uploadDate: doc.upload_date
            };
        });

        const response = {
            id: employee.id,
            referralId: employee.referral_id,
            role: employee.role,
            position: employee.position,
            location: employee.location,
            name: employee.name,
            email: employee.email,
            phone: employee.phone,
            guardianName: employee.guardian_name,
            guardianPhone: employee.guardian_phone,
            address: employee.address,
            status: employee.status,
            submissionDate: employee.submission_date,
            approvalDate: employee.approval_date,
            rejectionDate: employee.rejection_date,
            rejectionReason: employee.rejection_reason,
            documents,
            previousEmployment: employee.company ? {
                company: employee.company,
                role: employee.prev_role,
                experience: employee.prev_experience,
                relievingLetter: employee.relieving_letter_data ? {
                    name: employee.relieving_letter_name,
                    type: employee.relieving_letter_type,
                    data: employee.relieving_letter_data,
                    uploadDate: employee.relieving_letter_upload_date
                } : null
            } : null,
            offerLetter: employee.offer_letter_data ? {
                name: employee.offer_letter_name,
                type: employee.offer_letter_type,
                data: employee.offer_letter_data,
                uploadDate: employee.offer_letter_upload_date
            } : null
        };

        res.json(response);
    } catch (error) {
        console.error('Error fetching employee:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Approve employee
app.put('/api/employee/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const query = `
            UPDATE employees
            SET status = 'approved', approval_date = $1
            WHERE id = $2
            RETURNING *
        `;
        const result = await pool.query(query, [new Date().toISOString(), id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        res.json({ message: 'Employee approved successfully' });
    } catch (error) {
        console.error('Error approving employee:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Reject employee
app.put('/api/employee/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        if (!reason) {
            return res.status(400).json({ error: 'Rejection reason is required' });
        }
        const query = `
            UPDATE employees
            SET status = 'rejected', rejection_reason = $1, rejection_date = $2
            WHERE id = $3
            RETURNING *
        `;
        const result = await pool.query(query, [reason, new Date().toISOString(), id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        res.json({ message: 'Employee rejected successfully' });
    } catch (error) {
        console.error('Error rejecting employee:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Upload document
app.post('/api/employee/:id/upload', async (req, res) => {
    try {
        console.log(`POST /api/employee/${req.params.id}/upload called`); // Debug log
        const { id } = req.params;
        const { docType } = req.body;
        if (!req.files || !req.files.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const file = req.files.file;
        if (file.size > 5 * 1024 * 1024) {
            return res.status(400).json({ error: 'File size exceeds 5MB' });
        }

        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
        if (!allowedTypes.includes(file.mimetype)) {
            return res.status(400).json({ error: 'Only PDF, JPEG, and PNG files are allowed' });
        }

        const base64Data = file.data.toString('base64');
        const dataUrl = `data:${file.mimetype};base64,${base64Data}`;

        const query = `
            INSERT INTO documents (
                employee_id, document_type, file_name, file_type, file_data, upload_date
            ) VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (employee_id, document_type)
            DO UPDATE SET
                file_name = EXCLUDED.file_name,
                file_type = EXCLUDED.file_type,
                file_data = EXCLUDED.file_data,
                upload_date = EXCLUDED.upload_date
        `;
        await pool.query(query, [
            id, docType, file.name, file.mimetype, dataUrl, new Date().toISOString()
        ]);

        res.json({ message: `${docType} uploaded successfully` });
    } catch (error) {
        console.error('Error uploading document:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Upload offer letter
app.post('/api/employee/:id/offer-letter', async (req, res) => {
    try {
        console.log(`POST /api/employee/${req.params.id}/offer-letter called`); // Debug log
        const { id } = req.params;
        const { docType } = req.body; // Added to verify docType
        console.log('Request body:', req.body, 'Files:', req.files); // Debug log
        if (!req.files || !req.files.file) {
            return res.status(400).json({ error: 'No offer letter file uploaded' });
        }
        if (docType !== 'offerLetter') {
            return res.status(400).json({ error: 'Invalid document type' });
        }

        const file = req.files.file;
        if (file.size > 5 * 1024 * 1024) {
            return res.status(400).json({ error: 'File size exceeds 5MB' });
        }

        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
        if (!allowedTypes.includes(file.mimetype)) {
            return res.status(400).json({ error: 'Only PDF, JPEG, and PNG files are allowed' });
        }

        // Check if employee is approved
        const employeeQuery = `SELECT status FROM employees WHERE id = $1`;
        const employeeResult = await pool.query(employeeQuery, [id]);
        if (employeeResult.rows.length === 0) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        if (employeeResult.rows[0].status !== 'approved') {
            return res.status(400).json({ error: 'Employee must be approved before uploading an offer letter' });
        }

        const base64Data = file.data.toString('base64');
        const dataUrl = `data:${file.mimetype};base64,${base64Data}`;

        const query = `
            INSERT INTO offer_letters (
                employee_id, file_name, file_type, file_data, upload_date
            ) VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (employee_id)
            DO UPDATE SET
                file_name = EXCLUDED.file_name,
                file_type = EXCLUDED.file_type,
                file_data = EXCLUDED.file_data,
                upload_date = EXCLUDED.upload_date
        `;
        await pool.query(query, [
            id, file.name, file.mimetype, dataUrl, new Date().toISOString()
        ]);

        res.json({ message: 'Offer letter uploaded successfully' });
    } catch (error) {
        console.error('Error uploading offer letter:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Candidate offer letter retrieval
app.post('/api/candidate/offer-letter', async (req, res) => {
    try {
        const { email, name, referralId } = req.body;
        if (!email || !name || !referralId) {
            return res.status(400).json({ error: 'Email, name, and referral ID are required' });
        }

        const query = `
            SELECT e.id, e.status, ol.file_name, ol.file_type, ol.file_data, ol.upload_date
            FROM employees e
            LEFT JOIN offer_letters ol ON e.id = ol.employee_id
            WHERE e.email = $1 AND e.name = $2 AND e.referral_id = $3
        `;
        const result = await pool.query(query, [email, name, referralId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No matching employee found' });
        }

        const employee = result.rows[0];
        if (employee.status !== 'approved') {
            return res.status(403).json({ error: 'Employee is not approved' });
        }
        if (!employee.file_data) {
            return res.status(404).json({ error: 'Offer letter not found' });
        }

        res.json({
            offerLetter: {
                name: employee.file_name,
                type: employee.file_type,
                data: employee.file_data,
                uploadDate: employee.upload_date
            }
        });
    } catch (error) {
        console.error('Error retrieving offer letter:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete employees
app.delete('/api/employees', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'No employee IDs provided' });
        }

        const query = `
            DELETE FROM employees
            WHERE id = ANY($1)
        `;
        const result = await pool.query(query, [ids]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'No employees found' });
        }

        res.json({ message: 'Employees deleted successfully' });
    } catch (error) {
        console.error('Error deleting employees:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Clear all data
app.delete('/api/employees/clear', async (req, res) => {
    try {
        await pool.query('DELETE FROM offer_letters');
        await pool.query('DELETE FROM documents');
        await pool.query('DELETE FROM previous_employment');
        await pool.query('DELETE FROM employees');
        res.json({ message: 'All employee data cleared successfully' });
    } catch (error) {
        console.error('Error clearing data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all for undefined routes
app.use((req, res) => {
    console.log(`404: ${req.method} ${req.url}`); // Debug log
    res.status(404).json({ error: 'Endpoint not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3607;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});