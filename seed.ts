import { dataService } from './src/services/dataService';

export const seedData = async () => {
  // Add a sample campus
  const campusId = await dataService.add('campuses', {
    campusCode: 'MAIN-01',
    campusName: 'City Central Campus',
    address: '123 Education St, City Center',
    phone: '+1 234 567 890',
    email: 'main@faizan.com',
    isActive: true
  });

  if (campusId) {
    // Add a sample class
    const classId = await dataService.add('classes', {
      campusId,
      className: 'Grade 10',
      sectionName: 'Section A',
      capacity: 40,
      shift: 'Morning'
    });

    if (classId) {
      // Add a sample fee structure
      await dataService.add('feeStructures', {
        campusId,
        classId,
        tuitionFee: 500,
        admissionFee: 1000,
        examFee: 100,
        transportFee: 50,
        miscFee: 20
      });

      // Add a sample student
      await dataService.add('students', {
        campusId,
        classId,
        rollNumber: 'STU-001',
        firstName: 'John',
        lastName: 'Doe',
        fatherName: 'Richard Doe',
        dateOfBirth: '2010-05-15',
        gender: 'Male',
        mobile: '+1 987 654 321',
        address: '456 Student Ave, City Center',
        admissionDate: '2024-01-10',
        status: 'Active'
      });
    }
  }
};
