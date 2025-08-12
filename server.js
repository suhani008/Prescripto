const express = require('express')
const cors = require('cors')
const crypto = require('crypto')
require('dotenv').config()

const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(express.json())
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}))

// PhonePe Configuration
const PHONEPE_CONFIG = {
  merchantId: process.env.PHONEPE_MERCHANT_ID,
  saltKey: process.env.PHONEPE_SALT_KEY,
  saltIndex: parseInt(process.env.PHONEPE_SALT_INDEX),
  apiUrl: process.env.NODE_ENV === 'production' 
    ? process.env.PHONEPE_PROD_URL 
    : process.env.PHONEPE_TEST_URL
}

// In-memory storage for demo (use database in production)
const transactions = new Map()
const appointments = new Map()

// Utility function to create checksum
const createChecksum = (payload, endpoint) => {
  const string = payload + endpoint + PHONEPE_CONFIG.saltKey
  const checksum = crypto.createHash('sha256').update(string).digest('hex')
  return checksum + '###' + PHONEPE_CONFIG.saltIndex
}

// Generate unique transaction ID
const generateTransactionId = () => {
  return 'TXN' + Date.now() + Math.random().toString(36).substr(2, 9).toUpperCase()
}

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'PhonePe Backend Server is running',
    timestamp: new Date().toISOString()
  })
})

// Initiate Payment
app.post('/api/phonepe/initiate', async (req, res) => {
  try {
    console.log('Payment initiation request:', req.body)
    
    const { appointmentId, amount, userDetails, appointmentDetails } = req.body
    
    // Validation
    if (!appointmentId || !amount || !userDetails) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      })
    }

    const transactionId = generateTransactionId()
    const amountInPaisa = parseInt(amount) * 100
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'

    // Payment data for PhonePe
    const paymentData = {
      merchantId: PHONEPE_CONFIG.merchantId,
      merchantTransactionId: transactionId,
      merchantUserId: userDetails.userId || 'USER_' + Date.now(),
      amount: amountInPaisa,
      redirectUrl: `${frontendUrl}/payment-success?transactionId=${transactionId}`,
      redirectMode: 'POST',
      callbackUrl: `${req.protocol}://${req.get('host')}/api/phonepe/callback`,
      mobileNumber: userDetails.mobile || '9999999999',
      paymentInstrument: {
        type: 'PAY_PAGE'
      }
    }

    console.log('Payment data:', paymentData)

    // Convert to base64
    const payload = Buffer.from(JSON.stringify(paymentData)).toString('base64')
    const checksum = createChecksum(payload, '/pg/v1/pay')

    const requestData = {
      request: payload
    }

    console.log('Making request to PhonePe API...')

    // Make request to PhonePe
    const fetch = (await import('node-fetch')).default
    const response = await fetch(`${PHONEPE_CONFIG.apiUrl}/pg/v1/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': checksum,
        'accept': 'application/json'
      },
      body: JSON.stringify(requestData)
    })

    const result = await response.json()
    console.log('PhonePe API response:', result)

    if (result.success) {
      // Store transaction details
      transactions.set(transactionId, {
        transactionId,
        appointmentId,
        amount: amountInPaisa,
        status: 'PENDING',
        userDetails,
        appointmentDetails,
        createdAt: new Date().toISOString(),
        phonePeResponse: result.data
      })

      res.json({
        success: true,
        data: {
          transactionId,
          redirectUrl: result.data.instrumentResponse.redirectInfo.url
        }
      })
    } else {
      console.error('PhonePe API error:', result)
      res.status(400).json({
        success: false,
        message: result.message || 'Payment initialization failed'
      })
    }

  } catch (error) {
    console.error('Payment initiation error:', error)
    res.status(500).json({
      success: false,
      message: 'Internal server error: ' + error.message
    })
  }
})

// Payment Callback Handler
app.post('/api/phonepe/callback', async (req, res) => {
  try {
    console.log('Payment callback received:', req.body)
    console.log('Headers:', req.headers)

    const { response: callbackData } = req.body
    const xVerify = req.headers['x-verify']

    if (!callbackData) {
      return res.status(400).json({ success: false, message: 'No callback data received' })
    }

    // Decode and verify the callback
    const decodedData = Buffer.from(callbackData, 'base64').toString('utf8')
    const dataObject = JSON.parse(decodedData)
    
    console.log('Decoded callback data:', dataObject)

    // Verify checksum
    const expectedChecksum = createChecksum(callbackData, '/pg/v1/status')
    
    if (xVerify !== expectedChecksum) {
      console.error('Checksum mismatch:', { received: xVerify, expected: expectedChecksum })
      return res.status(400).json({ success: false, message: 'Invalid checksum' })
    }

    // Update transaction status
    const transaction = transactions.get(dataObject.merchantTransactionId)
    if (transaction) {
      transaction.status = dataObject.code === 'PAYMENT_SUCCESS' ? 'SUCCESS' : 'FAILED'
      transaction.updatedAt = new Date().toISOString()
      transaction.callbackData = dataObject
      
      console.log('Transaction updated:', transaction)
    }

    res.json({ success: true })

  } catch (error) {
    console.error('Callback error:', error)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
})

// Check Payment Status
app.post('/api/phonepe/status/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params
    console.log('Status check for transaction:', transactionId)
    
    // Check local transaction first
    const localTransaction = transactions.get(transactionId)
    if (!localTransaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      })
    }

    // Create status check request
    const statusEndpoint = `/pg/v1/status/${PHONEPE_CONFIG.merchantId}/${transactionId}`
    const statusChecksum = createChecksum('', statusEndpoint)

    const fetch = (await import('node-fetch')).default
    const response = await fetch(
      `${PHONEPE_CONFIG.apiUrl}${statusEndpoint}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': statusChecksum,
          'X-MERCHANT-ID': PHONEPE_CONFIG.merchantId,
          'accept': 'application/json'
        }
      }
    )

    const result = await response.json()
    console.log('PhonePe status response:', result)

    if (result.success) {
      // Update local transaction status
      if (result.data.state === 'COMPLETED') {
        localTransaction.status = 'SUCCESS'
      } else if (result.data.state === 'FAILED') {
        localTransaction.status = 'FAILED'
      }
      
      localTransaction.updatedAt = new Date().toISOString()
      localTransaction.phonePeStatusData = result.data

      // Return combined data
      res.json({
        success: true,
        data: {
          ...result.data,
          localTransaction
        }
      })
    } else {
      res.json(result)
    }

  } catch (error) {
    console.error('Status check error:', error)
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error: ' + error.message 
    })
  }
})

// Get all transactions (for admin/debugging)
app.get('/api/transactions', (req, res) => {
  const allTransactions = Array.from(transactions.values())
  res.json({
    success: true,
    count: allTransactions.length,
    data: allTransactions
  })
})

// Get specific transaction
app.get('/api/transactions/:transactionId', (req, res) => {
  const { transactionId } = req.params
  const transaction = transactions.get(transactionId)
  
  if (!transaction) {
    return res.status(404).json({
      success: false,
      message: 'Transaction not found'
    })
  }

  res.json({
    success: true,
    data: transaction
  })
})

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error)
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  })
})

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  })
})

// Start server
app.listen(PORT, () => {
  console.log(`🚀 PhonePe Backend Server running on port ${PORT}`)
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`💳 PhonePe Merchant ID: ${PHONEPE_CONFIG.merchantId}`)
  console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`)
})

module.exports = app