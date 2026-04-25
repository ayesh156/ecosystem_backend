import { Router } from 'express';
import { protect, requireShop } from '../middleware/auth';
import { 
  createSupplier, 
  getSuppliers, 
  getSupplierById, 
  updateSupplier, 
  deleteSupplier 
} from '../controllers/supplier.controller';

const router = Router();

router.use(protect, requireShop);

router.post('/', createSupplier);
router.get('/', getSuppliers);
router.get('/:id', getSupplierById);
router.put('/:id', updateSupplier);
router.delete('/:id', deleteSupplier);

export default router;
